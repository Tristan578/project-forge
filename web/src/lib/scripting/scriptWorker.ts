// Web Worker for sandboxed script execution.
// Receives: init (scripts + entity states), tick (dt + states), stop
// Sends: commands (engine commands), log (console output), error (runtime errors), ui (HUD updates)

import { injectLoopGuards } from './loopGuards';
import { SHADOWED_GLOBALS } from './sandboxGlobals';

interface ScriptInstance {
  entityId: string;
  onStart?: () => void;
  onUpdate?: (dt: number) => void;
  onDestroy?: () => void;
}

interface EntityState {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

interface EntityInfo {
  name: string;
  type: string;
  colliderRadius: number;
  currentFrame?: number;
}

interface InputState {
  pressed: Record<string, boolean>;
  justPressed: Record<string, boolean>;
  justReleased: Record<string, boolean>;
  axes: Record<string, number>;
}

interface EngineCommand {
  cmd: string;
  [key: string]: unknown;
}

interface UIElement {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize?: number;
  color?: string;
  visible: boolean;
}

// Synced 2D state (populated from main thread on init/tick)
interface TilemapState {
  tileSize: [number, number];
  mapSize: [number, number];
  layers: { tiles: (number | null)[] }[];
  origin: 'TopLeft' | 'Center';
}

interface SkeletonState {
  bones: { name: string; parentBone: string | null; localPosition: [number, number]; localRotation: number; localScale: [number, number]; length: number }[];
  activeSkin: string;
}

interface Physics2dVelocityState {
  velocity: [number, number];
  angularVelocity: number;
}

// Accumulated commands from forge.* calls
let pendingCommands: EngineCommand[] = [];
let entityStates: Record<string, EntityState> = {};
let entityInfos: Record<string, EntityInfo> = {};
let currentInput: InputState = { pressed: {}, justPressed: {}, justReleased: {}, axes: {} };
const timeData = { delta: 0, elapsed: 0 };
let sharedState: Record<string, unknown> = {};
// Touch capability is sent from the main thread in the 'init' message.
// Workers cannot safely access navigator.maxTouchPoints (it may not exist).
let isTouchDeviceFlag = false;
const audioPlayingState = new Map<string, boolean>();
let scripts: ScriptInstance[] = [];
let spawnCounter = 0;
const uiElements: Map<string, UIElement> = new Map();
let uiDirty = false;

// ─── Async Channel Protocol ─────────────────────────────────────

interface PendingAsyncRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: { percent: number; message?: string }) => void;
  channel: string;
  method: string;
}

const pendingAsyncRequests = new Map<string, PendingAsyncRequest>();
let nextRequestId = 0;

function generateRequestId(): string {
  return `req_${++nextRequestId}`;
}

function asyncRequest(
  channel: string,
  method: string,
  args: unknown,
  onProgress?: (progress: { percent: number; message?: string }) => void,
): Promise<unknown> {
  const requestId = generateRequestId();

  return new Promise((resolve, reject) => {
    pendingAsyncRequests.set(requestId, {
      resolve, reject, onProgress,
      channel, method,
    });

    (self as unknown as Worker).postMessage({
      type: 'async_request',
      requestId, channel, method, args,
    });
  });
}

function processAsyncResponses(responses: Array<{
  requestId: string;
  status: 'ok' | 'error' | 'progress';
  data?: unknown;
  error?: string;
  progress?: { percent: number; message?: string };
}>) {
  for (const resp of responses) {
    const pending = pendingAsyncRequests.get(resp.requestId);
    if (!pending) continue;

    if (resp.status === 'ok') {
      pending.resolve(resp.data);
      pendingAsyncRequests.delete(resp.requestId);
    } else if (resp.status === 'error') {
      pending.reject(new Error(resp.error || 'Unknown async error'));
      pendingAsyncRequests.delete(resp.requestId);
    } else if (resp.status === 'progress') {
      pending.onProgress?.(resp.progress ?? { percent: 0 });
    }
  }
}

function clearPendingAsyncRequests(reason: string) {
  for (const [, req] of pendingAsyncRequests) {
    req.reject(new Error(reason));
  }
  pendingAsyncRequests.clear();
  nextRequestId = 0;
}

// Synced domain state (from main thread)
let tilemapStates: Record<string, TilemapState> = {};
let skeletonStates: Record<string, SkeletonState> = {};
let physics2dVelocities: Record<string, Physics2dVelocityState> = {};

// Previous frame positions for velocity estimation
let prevEntityStates: Record<string, EntityState> = {};

// UI Builder screen visibility (synced from main thread)
const screenVisibility: Record<string, boolean> = {};
const widgetValues: Record<string, unknown> = {};

// Shared state (synced from main thread)
const _sharedState: Record<string, unknown> & { cameraMode: string; dialogueActive: boolean } = {
  cameraMode: 'thirdPersonFollow',
  dialogueActive: false,
};

// Collision callback registries
const collisionEnterCallbacks: Map<string, (otherId: string) => void> = new Map();
const collisionExitCallbacks: Map<string, (otherId: string) => void> = new Map();

function distanceBetween(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Build the forge API object that scripts can call
function buildForgeApi(scriptEntityId: string) {
  return {
    getTransform: (eid: string) => entityStates[eid] || null,
    setPosition: (eid: string, x: number, y: number, z: number) => {
      pendingCommands.push({ cmd: 'update_transform', entityId: eid, position: [x, y, z] });
    },
    setRotation: (eid: string, x: number, y: number, z: number) => {
      pendingCommands.push({ cmd: 'update_transform', entityId: eid, rotation: [x, y, z] });
    },
    translate: (eid: string, dx: number, dy: number, dz: number) => {
      const state = entityStates[eid];
      if (state) {
        pendingCommands.push({
          cmd: 'update_transform',
          entityId: eid,
          position: [state.position[0] + dx, state.position[1] + dy, state.position[2] + dz],
        });
      }
    },
    rotate: (eid: string, dx: number, dy: number, dz: number) => {
      const state = entityStates[eid];
      if (state) {
        const degToRad = Math.PI / 180;
        pendingCommands.push({
          cmd: 'update_transform',
          entityId: eid,
          rotation: [
            state.rotation[0] + dx * degToRad,
            state.rotation[1] + dy * degToRad,
            state.rotation[2] + dz * degToRad,
          ],
        });
      }
    },
    spawn: (type: string, options?: { name?: string; position?: [number, number, number] }) => {
      const id = `runtime_${++spawnCounter}`;
      pendingCommands.push({ cmd: 'spawn_entity', entityType: type, name: options?.name, position: options?.position });
      return id;
    },
    destroy: (eid: string) => {
      pendingCommands.push({ cmd: 'delete_entities', entityIds: [eid] });
    },
    log: (msg: string) => {
      (self as unknown as Worker).postMessage({ type: 'log', level: 'info', entityId: scriptEntityId, message: String(msg) });
    },
    warn: (msg: string) => {
      (self as unknown as Worker).postMessage({ type: 'log', level: 'warn', entityId: scriptEntityId, message: String(msg) });
    },
    error: (msg: string) => {
      (self as unknown as Worker).postMessage({ type: 'log', level: 'error', entityId: scriptEntityId, message: String(msg) });
    },

    // --- Visual control ---
    setColor: (eid: string, r: number, g: number, b: number, a?: number) => {
      pendingCommands.push({ cmd: 'update_material', entityId: eid, baseColor: [r, g, b, a ?? 1.0] });
    },
    setVisibility: (eid: string, visible: boolean) => {
      pendingCommands.push({ cmd: 'set_visibility', entityId: eid, visible });
    },
    setEmissive: (eid: string, r: number, g: number, b: number, intensity?: number) => {
      pendingCommands.push({ cmd: 'update_material', entityId: eid, emissive: [r, g, b, intensity ?? 1.0] });
    },

    // --- Scene queries ---
    scene: {
      getEntities: () => {
        return Object.entries(entityInfos).map(([id, info]) => ({
          id,
          name: info.name,
          type: info.type,
          position: entityStates[id]?.position ?? [0, 0, 0],
        }));
      },
      findByName: (name: string) => {
        const results: string[] = [];
        for (const [id, info] of Object.entries(entityInfos)) {
          if (info.name.toLowerCase().includes(name.toLowerCase())) {
            results.push(id);
          }
        }
        return results;
      },
      findByNameExact: (name: string) => {
        const results: string[] = [];
        for (const [id, info] of Object.entries(entityInfos)) {
          if (info.name === name) {
            results.push(id);
          }
        }
        return results;
      },
      getEntityName: (eid: string) => entityInfos[eid]?.name ?? null,
      getEntityType: (eid: string) => entityInfos[eid]?.type ?? null,
      getEntitiesInRadius: (position: [number, number, number], radius: number) => {
        const results: string[] = [];
        for (const [id, state] of Object.entries(entityStates)) {
          if (distanceBetween(position, state.position) <= radius) {
            results.push(id);
          }
        }
        return results;
      },
      reset: () => {
        pendingCommands.push({ cmd: 'stop' });
      },
      load: (sceneName: string, transition?: Record<string, unknown>) => {
        (self as unknown as Worker).postMessage({ type: 'scene_load', sceneName, transition });
      },
      restart: () => {
        (self as unknown as Worker).postMessage({ type: 'scene_restart' });
      },
      getCurrent: () => {
        // Will be set from main thread on init/tick
        return (self as unknown as Record<string, unknown>).__currentScene as string || 'Main';
      },
      getAll: () => {
        return ((self as unknown as Record<string, unknown>).__allSceneNames as string[]) || [];
      },
    },

    input: {
      isPressed: (action: string) => !!currentInput.pressed[action],
      justPressed: (action: string) => !!currentInput.justPressed[action],
      justReleased: (action: string) => !!currentInput.justReleased[action],
      getAxis: (action: string) => currentInput.axes[action] ?? 0,
      isTouchDevice: () => {
        // Touch capability is derived from the main thread's init message.
        // Workers cannot reliably access navigator.maxTouchPoints — it may be
        // undefined in the worker context and the worker cannot query the DOM.
        return isTouchDeviceFlag;
      },
      vibrate: (pattern: number[]) => {
        pendingCommands.push({ cmd: 'vibrate', pattern });
      },
    },
    physics: {
      applyForce: (eid: string, fx: number, fy: number, fz: number) => {
        pendingCommands.push({ cmd: 'apply_force', entityId: eid, force: [fx, fy, fz], isImpulse: false });
      },
      applyImpulse: (eid: string, fx: number, fy: number, fz: number) => {
        pendingCommands.push({ cmd: 'apply_force', entityId: eid, force: [fx, fy, fz], isImpulse: true });
      },
      setVelocity: (eid: string, vx: number, vy: number, vz: number) => {
        pendingCommands.push({ cmd: 'set_velocity', entityId: eid, velocity: [vx, vy, vz] });
      },
      getContacts: (eid: string, radius?: number) => {
        const state = entityStates[eid];
        if (!state) return [];
        const info = entityInfos[eid];
        const colliderR = info?.colliderRadius ?? 0.5;
        const checkRadius = radius ?? colliderR;
        const contacts: string[] = [];
        for (const [otherId, otherState] of Object.entries(entityStates)) {
          if (otherId === eid) continue;
          const otherInfo = entityInfos[otherId];
          const otherR = otherInfo?.colliderRadius ?? 0.5;
          const dist = distanceBetween(state.position, otherState.position);
          if (dist <= checkRadius + otherR) {
            contacts.push(otherId);
          }
        }
        return contacts;
      },
      distanceTo: (eidA: string, eidB: string) => {
        const a = entityStates[eidA];
        const b = entityStates[eidB];
        if (!a || !b) return Infinity;
        return distanceBetween(a.position, b.position);
      },
      onCollisionEnter: (eid: string, callback: (otherId: string) => void) => {
        collisionEnterCallbacks.set(eid, callback);
      },
      onCollisionExit: (eid: string, callback: (otherId: string) => void) => {
        collisionExitCallbacks.set(eid, callback);
      },
      offCollision: (eid: string) => {
        collisionEnterCallbacks.delete(eid);
        collisionExitCallbacks.delete(eid);
      },
    },
    physics2d: {
      applyForce: (eid: string, forceX: number, forceY: number) => {
        pendingCommands.push({ cmd: 'apply_force2d', entityId: eid, forceX, forceY });
      },
      applyImpulse: (eid: string, impulseX: number, impulseY: number) => {
        pendingCommands.push({ cmd: 'apply_impulse2d', entityId: eid, impulseX, impulseY });
      },
      setVelocity: (eid: string, vx: number, vy: number) => {
        pendingCommands.push({ cmd: 'set_velocity2d', entityId: eid, velocityX: vx, velocityY: vy });
      },
      getVelocity: (eid: string): { x: number; y: number } | null => {
        const state = physics2dVelocities[eid];
        if (!state) return null;
        return { x: state.velocity[0], y: state.velocity[1] };
      },
      setAngularVelocity: (eid: string, omega: number) => {
        pendingCommands.push({ cmd: 'set_angular_velocity2d', entityId: eid, omega });
      },
      getAngularVelocity: (eid: string): number | null => {
        const state = physics2dVelocities[eid];
        return state?.angularVelocity ?? null;
      },
      raycast: async (originX: number, originY: number, dirX: number, dirY: number, maxDistance?: number) => {
        return asyncRequest('physics', 'raycast2d', { originX, originY, dirX, dirY, maxDistance: maxDistance ?? 100 });
      },
      isGrounded: async (eid: string, distance?: number) => {
        return asyncRequest('physics', 'isGrounded', { entityId: eid, distance: distance ?? 0.1 });
      },
      setGravity: (x: number, y: number) => {
        pendingCommands.push({ cmd: 'set_gravity2d', gravityX: x, gravityY: y });
      },
      onCollisionEnter: (callback: (event: { entityId: string; otherEntityId: string; otherEntityName: string }) => void) => {
        // Store callback in global array
        const callbacks = ((self as unknown as Record<string, unknown>).__collision2dEnterCallbacks as Array<typeof callback>) || [];
        callbacks.push(callback);
        (self as unknown as Record<string, unknown>).__collision2dEnterCallbacks = callbacks;
        // Return unsubscribe function
        return () => {
          const idx = callbacks.indexOf(callback);
          if (idx >= 0) callbacks.splice(idx, 1);
        };
      },
      onCollisionExit: (callback: (event: { entityId: string; otherEntityId: string; otherEntityName: string }) => void) => {
        const callbacks = ((self as unknown as Record<string, unknown>).__collision2dExitCallbacks as Array<typeof callback>) || [];
        callbacks.push(callback);
        (self as unknown as Record<string, unknown>).__collision2dExitCallbacks = callbacks;
        return () => {
          const idx = callbacks.indexOf(callback);
          if (idx >= 0) callbacks.splice(idx, 1);
        };
      },
    },
    particles: {
      setPreset: (eid: string, preset: string) => {
        pendingCommands.push({ cmd: 'set_particle_preset', entityId: eid, preset });
      },
      enable: (eid: string) => {
        pendingCommands.push({ cmd: 'toggle_particle', entityId: eid, enabled: true });
      },
      disable: (eid: string) => {
        pendingCommands.push({ cmd: 'toggle_particle', entityId: eid, enabled: false });
      },
      burst: (eid: string) => {
        pendingCommands.push({ cmd: 'burst_particle', entityId: eid });
      },
    },
    animation: {
      play: (eid: string, clipName: string, crossfadeSecs?: number) => {
        pendingCommands.push({ cmd: 'play_animation', entityId: eid, clipName, crossfadeSecs: crossfadeSecs ?? 0.3 });
      },
      pause: (eid: string) => {
        pendingCommands.push({ cmd: 'pause_animation', entityId: eid });
      },
      resume: (eid: string) => {
        pendingCommands.push({ cmd: 'resume_animation', entityId: eid });
      },
      stop: (eid: string) => {
        pendingCommands.push({ cmd: 'stop_animation', entityId: eid });
      },
      setSpeed: (eid: string, speed: number) => {
        pendingCommands.push({ cmd: 'set_animation_speed', entityId: eid, speed });
      },
      setLoop: (eid: string, looping: boolean) => {
        pendingCommands.push({ cmd: 'set_animation_loop', entityId: eid, looping });
      },
      setBlendWeight: (eid: string, clipName: string, weight: number) => {
        pendingCommands.push({ cmd: 'set_animation_blend_weight', entityId: eid, clipName, weight });
      },
      setClipSpeed: (eid: string, clipName: string, speed: number) => {
        pendingCommands.push({ cmd: 'set_clip_speed', entityId: eid, clipName, speed });
      },
      listClips: async (entityId: string) => {
        return asyncRequest('animation', 'listClips', { entityId });
      },
      getClipDuration: async (entityId: string, clipName: string) => {
        return asyncRequest('animation', 'getClipDuration', { entityId, clipName });
      },
    },
    tilemap: {
      getTile: (tilemapId: string, x: number, y: number, layer = 0) => {
        const tilemap = tilemapStates[tilemapId];
        if (!tilemap) return null;
        const layerData = tilemap.layers[layer];
        if (!layerData) return null;
        const [mapW] = tilemap.mapSize;
        if (x < 0 || y < 0 || x >= mapW || y >= tilemap.mapSize[1]) return null;
        const idx = y * mapW + x;
        return layerData.tiles[idx] ?? null;
      },
      setTile: (tilemapId: string, x: number, y: number, tileId: number | null, layer = 0) => {
        pendingCommands.push({ cmd: 'set_tile', tilemapId, x, y, tileId, layer });
      },
      fillRect: (tilemapId: string, x: number, y: number, w: number, h: number, tileId: number | null, layer = 0) => {
        pendingCommands.push({ cmd: 'fill_tiles', tilemapId, x, y, width: w, height: h, tileId, layer });
      },
      clearTile: (tilemapId: string, x: number, y: number, layer = 0) => {
        pendingCommands.push({ cmd: 'clear_tiles', tilemapId, x, y, width: 1, height: 1, layer });
      },
      worldToTile: (tilemapId: string, worldX: number, worldY: number): [number, number] => {
        const tilemap = tilemapStates[tilemapId];
        const tileW = tilemap?.tileSize[0] ?? 32;
        const tileH = tilemap?.tileSize[1] ?? 32;
        const mapW = tilemap?.mapSize[0] ?? 0;
        const mapH = tilemap?.mapSize[1] ?? 0;
        // Center-origin tilemaps offset by half the map size
        const isCenter = tilemap?.origin === 'Center';
        const offsetX = isCenter ? (mapW * tileW) / 2 : 0;
        const offsetY = isCenter ? (mapH * tileH) / 2 : 0;
        const tileX = Math.floor((worldX + offsetX) / tileW);
        const tileY = Math.floor((-worldY + offsetY) / tileH);
        return [tileX, tileY];
      },
      tileToWorld: (tilemapId: string, tileX: number, tileY: number): [number, number] => {
        const tilemap = tilemapStates[tilemapId];
        const tileW = tilemap?.tileSize[0] ?? 32;
        const tileH = tilemap?.tileSize[1] ?? 32;
        const mapW = tilemap?.mapSize[0] ?? 0;
        const mapH = tilemap?.mapSize[1] ?? 0;
        const isCenter = tilemap?.origin === 'Center';
        const offsetX = isCenter ? (mapW * tileW) / 2 : 0;
        const offsetY = isCenter ? (mapH * tileH) / 2 : 0;
        const worldX = tileX * tileW - offsetX;
        const worldY = -(tileY * tileH - offsetY);
        return [worldX, worldY];
      },
      getMapSize: (tilemapId: string): [number, number] => {
        const tilemap = tilemapStates[tilemapId];
        return tilemap?.mapSize ?? [0, 0];
      },
      resize: (tilemapId: string, width: number, height: number, anchor = 'top-left') => {
        pendingCommands.push({ cmd: 'resize_tilemap', tilemapId, width, height, anchor });
      },
    },
    audio: {
      play: (eid: string) => {
        pendingCommands.push({ cmd: 'play_audio', entityId: eid });
        audioPlayingState.set(eid, true);
      },
      stop: (eid: string) => {
        pendingCommands.push({ cmd: 'stop_audio', entityId: eid });
        audioPlayingState.set(eid, false);
      },
      pause: (eid: string) => {
        pendingCommands.push({ cmd: 'pause_audio', entityId: eid });
        audioPlayingState.set(eid, false);
      },
      setVolume: (eid: string, volume: number) => {
        pendingCommands.push({ cmd: 'set_audio', entityId: eid, volume });
      },
      setPitch: (eid: string, pitch: number) => {
        pendingCommands.push({ cmd: 'set_audio', entityId: eid, pitch });
      },
      isPlaying: (eid: string) => {
        return audioPlayingState.get(eid) ?? false;
      },
      setBusVolume: (busName: string, volume: number) => {
        pendingCommands.push({ cmd: 'update_audio_bus', busName, volume });
      },
      muteBus: (busName: string, muted: boolean) => {
        pendingCommands.push({ cmd: 'update_audio_bus', busName, muted });
      },
      getBusVolume: (_busName: string) => {
        return 1.0;
      },
      isBusMuted: (_busName: string) => {
        return false;
      },
      addLayer: (eid: string, slotName: string, assetId: string, options?: {
        volume?: number; pitch?: number; loop?: boolean; spatial?: boolean; bus?: string;
      }) => {
        pendingCommands.push({
          cmd: 'audio_add_layer', entityId: eid, slotName, assetId,
          volume: options?.volume, pitch: options?.pitch, loop: options?.loop,
          spatial: options?.spatial, bus: options?.bus,
        });
      },
      removeLayer: (eid: string, slotName: string) => {
        pendingCommands.push({ cmd: 'audio_remove_layer', entityId: eid, slotName });
      },
      removeAllLayers: (eid: string) => {
        pendingCommands.push({ cmd: 'audio_remove_all_layers', entityId: eid });
      },
      crossfade: (fromEid: string, toEid: string, durationMs: number) => {
        pendingCommands.push({ cmd: 'audio_crossfade', fromEntityId: fromEid, toEntityId: toEid, durationMs });
      },
      playOneShot: (assetId: string, options?: {
        position?: [number, number, number]; bus?: string; volume?: number; pitch?: number;
      }) => {
        pendingCommands.push({
          cmd: 'audio_play_one_shot', assetId,
          position: options?.position, bus: options?.bus,
          volume: options?.volume, pitch: options?.pitch,
        });
      },
      fadeIn: (eid: string, durationMs: number) => {
        pendingCommands.push({ cmd: 'audio_fade_in', entityId: eid, durationMs });
      },
      fadeOut: (eid: string, durationMs: number) => {
        pendingCommands.push({ cmd: 'audio_fade_out', entityId: eid, durationMs });
      },
      setMusicIntensity: (level: number) => {
        pendingCommands.push({ cmd: 'set_music_intensity', intensity: level });
      },
      loadStems: (stems: Record<string, string>) => {
        pendingCommands.push({ cmd: 'set_music_stems', stems });
      },
      saveSnapshot: (name: string, crossfadeDurationMs?: number) => {
        pendingCommands.push({ cmd: 'audio_save_snapshot', name, crossfadeDurationMs: crossfadeDurationMs ?? 1000 });
      },
      loadSnapshot: (name: string, durationMs?: number) => {
        pendingCommands.push({ cmd: 'audio_load_snapshot', name, ...(durationMs !== undefined && { durationMs }) });
      },
      detectLoopPoints: async (assetId: string) => {
        return asyncRequest('audio', 'detectLoopPoints', { assetId });
      },
      getWaveform: async (assetId: string) => {
        return asyncRequest('audio', 'getWaveform', { assetId });
      },
    },

    // --- AI asset generation ---
    ai: {
      generateTexture: async (prompt: string, onProgress?: (p: number) => void) => {
        return asyncRequest('ai', 'generateTexture', { prompt }, onProgress ? (prog) => onProgress(prog.percent) : undefined);
      },
      generateModel: async (prompt: string, onProgress?: (p: number) => void) => {
        return asyncRequest('ai', 'generateModel', { prompt }, onProgress ? (prog) => onProgress(prog.percent) : undefined);
      },
      generateSound: async (prompt: string, onProgress?: (p: number) => void) => {
        return asyncRequest('ai', 'generateSound', { prompt }, onProgress ? (prog) => onProgress(prog.percent) : undefined);
      },
      generateVoice: async (text: string, onProgress?: (p: number) => void) => {
        return asyncRequest('ai', 'generateVoice', { prompt: text }, onProgress ? (prog) => onProgress(prog.percent) : undefined);
      },
      generateMusic: async (prompt: string, onProgress?: (p: number) => void) => {
        return asyncRequest('ai', 'generateMusic', { prompt }, onProgress ? (prog) => onProgress(prog.percent) : undefined);
      },
    },

    // --- Asset loading ---
    asset: {
      loadImage: async (url: string) => {
        return asyncRequest('asset', 'loadImage', { url });
      },
      loadModel: async (url: string) => {
        return asyncRequest('asset', 'loadModel', { url });
      },
    },

    // --- UI/HUD system ---
    ui: {
      showText: (id: string, text: string, x: number, y: number, options?: {
        fontSize?: number; color?: string;
      }) => {
        uiElements.set(id, {
          id, text, x, y,
          fontSize: options?.fontSize ?? 24,
          color: options?.color ?? 'white',
          visible: true,
        });
        uiDirty = true;
      },
      updateText: (id: string, text: string) => {
        const el = uiElements.get(id);
        if (el) {
          el.text = text;
          uiDirty = true;
        }
      },
      removeText: (id: string) => {
        uiElements.delete(id);
        uiDirty = true;
      },
      clear: () => {
        uiElements.clear();
        uiDirty = true;
      },

      // --- UI Builder screen management ---
      showScreen: (nameOrId: string) => {
        (self as unknown as Worker).postMessage({ type: 'ui_screen', action: 'show', target: nameOrId });
      },
      hideScreen: (nameOrId: string) => {
        (self as unknown as Worker).postMessage({ type: 'ui_screen', action: 'hide', target: nameOrId });
      },
      toggleScreen: (nameOrId: string) => {
        (self as unknown as Worker).postMessage({ type: 'ui_screen', action: 'toggle', target: nameOrId });
      },
      isScreenVisible: (nameOrId: string) => {
        return screenVisibility[nameOrId] ?? false;
      },
      hideAllScreens: () => {
        (self as unknown as Worker).postMessage({ type: 'ui_screen', action: 'hide_all' });
      },

      // --- UI Builder widget manipulation ---
      setWidgetText: (screen: string, widget: string, text: string) => {
        (self as unknown as Worker).postMessage({ type: 'ui_widget', action: 'set_text', screen, widget, text });
      },
      setWidgetVisible: (screen: string, widget: string, visible: boolean) => {
        (self as unknown as Worker).postMessage({ type: 'ui_widget', action: 'set_visible', screen, widget, visible });
      },
      setWidgetStyle: (screen: string, widget: string, style: Record<string, unknown>) => {
        (self as unknown as Worker).postMessage({ type: 'ui_widget', action: 'set_style', screen, widget, style });
      },
      getWidgetValue: (screen: string, widget: string) => {
        return widgetValues[`${screen}:${widget}`] ?? null;
      },
    },

    // --- Camera control ---
    camera: {
      follow: (eid: string, offset?: [number, number, number]) => {
        pendingCommands.push({
          cmd: 'camera_follow',
          entityId: eid,
          offset: offset ?? [0, 2, -5],
        });
      },
      stopFollow: () => {
        pendingCommands.push({ cmd: 'camera_stop_follow' });
      },
      setPosition: (x: number, y: number, z: number) => {
        pendingCommands.push({ cmd: 'camera_set_position', position: [x, y, z] });
      },
      lookAt: (x: number, y: number, z: number) => {
        pendingCommands.push({ cmd: 'camera_look_at', target: [x, y, z] });
      },
      setMode: (mode: string) => {
        (self as unknown as Worker).postMessage({ type: 'camera_set_mode', mode });
      },
      setTarget: (eid: string) => {
        (self as unknown as Worker).postMessage({ type: 'camera_set_target', entityId: eid });
      },
      shake: (intensity: number, duration: number) => {
        (self as unknown as Worker).postMessage({ type: 'camera_shake', intensity, duration });
      },
      getMode: () => {
        // Sync access from shared state
        return _sharedState.cameraMode || 'thirdPersonFollow';
      },
      setProperty: (property: string, value: number) => {
        (self as unknown as Worker).postMessage({ type: 'camera_set_property', property, value });
      },
    },

    // --- Dialogue control ---
    dialogue: {
      start: (treeId: string) => {
        (self as unknown as Worker).postMessage({ type: 'dialogue_start', treeId });
      },
      isActive: () => {
        return !!_sharedState.dialogueActive;
      },
      end: () => {
        (self as unknown as Worker).postMessage({ type: 'dialogue_end' });
      },
      advance: () => {
        (self as unknown as Worker).postMessage({ type: 'dialogue_advance' });
      },
      skip: () => {
        (self as unknown as Worker).postMessage({ type: 'dialogue_skip' });
      },
      setVariable: (treeId: string, key: string, value: unknown) => {
        (self as unknown as Worker).postMessage({ type: 'dialogue_set_variable', treeId, key, value });
      },
      getVariable: (treeId: string, key: string) => {
        return _sharedState[`dialogue_var_${treeId}_${key}`];
      },
      onStart: (callback: (treeId: string) => void) => {
        _sharedState._dialogueOnStart = callback;
      },
      onEnd: (callback: () => void) => {
        _sharedState._dialogueOnEnd = callback;
      },
      onChoice: (callback: (choiceId: string, choiceText: string) => void) => {
        _sharedState._dialogueOnChoice = callback;
      },
    },

    // --- Sprite animation control ---
    sprite: {
      playAnimation: (eid: string, clipName: string) => {
        pendingCommands.push({ cmd: 'play_sprite_animation', entityId: eid, clipName });
      },
      stopAnimation: (eid: string) => {
        pendingCommands.push({ cmd: 'stop_sprite_animation', entityId: eid });
      },
      setAnimSpeed: (eid: string, speed: number) => {
        pendingCommands.push({ cmd: 'set_sprite_anim_speed', entityId: eid, speed });
      },
      setAnimParam: (eid: string, paramName: string, value: number | boolean) => {
        pendingCommands.push({ cmd: 'set_sprite_anim_param', entityId: eid, paramName, value });
      },
      getCurrentFrame: (eid: string) => {
        return entityInfos[eid]?.currentFrame ?? 0;
      },
    },

    // --- Skeletal 2D animation control (old namespace - for compatibility) ---
    skeleton: {
      addBone: (eid: string, bone: Partial<{ name: string; parentBone: string | null; position: [number, number]; rotation: number; length: number }>) => {
        pendingCommands.push({
          cmd: 'add_bone2d',
          entityId: eid,
          name: bone.name ?? 'bone',
          parent_bone: bone.parentBone ?? null,
          position: bone.position ?? [0, 0],
          rotation: bone.rotation ?? 0,
          length: bone.length ?? 50,
        });
      },
      removeBone: (eid: string, boneName: string) => {
        pendingCommands.push({ cmd: 'remove_bone2d', entityId: eid, bone_name: boneName });
      },
      updateBone: (eid: string, boneName: string, updates: Partial<{ position: [number, number]; rotation: number; scale: [number, number]; length: number }>) => {
        pendingCommands.push({
          cmd: 'update_bone2d',
          entityId: eid,
          bone_name: boneName,
          ...updates,
        });
      },
      getBones: (eid: string) => {
        const skeleton = skeletonStates[eid];
        if (!skeleton?.bones) return null;
        return skeleton.bones.map(b => ({
          name: b.name,
          parentBone: b.parentBone,
          position: b.localPosition,
          rotation: b.localRotation,
          scale: b.localScale,
          length: b.length,
        }));
      },
      playAnimation: (eid: string, animName: string, options?: { loop?: boolean; speed?: number; crossfade?: number }) => {
        pendingCommands.push({
          cmd: 'play_skeletal_animation2d',
          entityId: eid,
          anim_name: animName,
          loop: options?.loop ?? true,
          speed: options?.speed ?? 1.0,
          crossfade: options?.crossfade ?? 0.0,
        });
      },
      stopAnimation: (eid: string) => {
        pendingCommands.push({ cmd: 'stop_skeletal_animation2d', entityId: eid });
      },
      setSkin: (eid: string, skinName: string) => {
        pendingCommands.push({ cmd: 'set_skeleton2d_skin', entityId: eid, skin_name: skinName });
      },
      getSkin: (eid: string) => {
        const skeleton = skeletonStates[eid];
        return skeleton?.activeSkin ?? null;
      },
      setIkTarget: (eid: string, constraintName: string, targetX: number, targetY: number) => {
        pendingCommands.push({
          cmd: 'set_ik_target2d',
          entityId: eid,
          constraint_name: constraintName,
          target_x: targetX,
          target_y: targetY,
        });
      },
    },

    // --- Skeletal 2D animation control (new namespace) ---
    skeleton2d: {
      createSkeleton: (eid: string) => {
        pendingCommands.push({ cmd: 'create_skeleton2d', entityId: eid });
      },
      addBone: (eid: string, boneName: string, parentBone: string | null, x: number, y: number, rotation: number, length: number) => {
        pendingCommands.push({ cmd: 'add_bone2d', entityId: eid, boneName, parentBone, positionX: x, positionY: y, rotation, length });
      },
      removeBone: (eid: string, boneName: string) => {
        pendingCommands.push({ cmd: 'remove_bone2d', entityId: eid, boneName });
      },
      updateBone: (eid: string, boneName: string, x: number, y: number, rotation: number, length: number) => {
        pendingCommands.push({ cmd: 'update_bone2d', entityId: eid, boneName, positionX: x, positionY: y, rotation, length });
      },
      setSkin: (eid: string, skinName: string) => {
        pendingCommands.push({ cmd: 'set_skeleton2d_skin', entityId: eid, skinName });
      },
      playAnimation: (eid: string, animationName: string) => {
        pendingCommands.push({ cmd: 'play_skeletal_animation2d', entityId: eid, animationName });
      },
      getBones: (eid: string) => {
        const skeleton = skeletonStates[eid];
        if (!skeleton?.bones) return null;
        return skeleton.bones.map(b => ({
          name: b.name,
          parentBone: b.parentBone,
          x: b.localPosition[0],
          y: b.localPosition[1],
          rotation: b.localRotation,
          scale: b.localScale,
          length: b.length,
        }));
      },
    },

    time: {
      get delta() { return timeData.delta; },
      get elapsed() { return timeData.elapsed; },
    },
    state: {
      get: (key: string) => sharedState[key],
      set: (key: string, value: unknown) => { sharedState[key] = value; },
    },
    screen: {
      get orientation() {
        return 'landscape-primary'; // Workers can't access screen orientation
      },
    },

    // ─── Async Channel Protocol (internal bridge) ─────────────────
    __asyncRequest: (
      channel: string,
      method: string,
      args: unknown,
      onProgress?: (progress: { percent: number; message?: string }) => void,
    ) => asyncRequest(channel, method, args, onProgress),
  };
}

// SHADOWED_GLOBALS imported from './sandboxGlobals' — shared with scriptBundler and tests.

// ─── Resource Limits ────────────────────────────────────────────
// These constants cap per-frame execution time and heap growth.
// Tests may override them by posting a 'set_limits' message before 'init'.

const SCRIPT_MEMORY_LIMIT_MB = 50;
const SCRIPT_FRAME_TIME_LIMIT_MS = 100;
const SCRIPT_FRAME_TIME_WARN_MS = 16;

let memoryLimitMb = SCRIPT_MEMORY_LIMIT_MB;
let frameTimeLimitMs = SCRIPT_FRAME_TIME_LIMIT_MS;
let frameTimeWarnMs = SCRIPT_FRAME_TIME_WARN_MS;

/**
 * Returns current JS heap usage in MB using the Chrome-only
 * `performance.memory` API when available.  Returns -1 if the
 * API is not present (Firefox / Safari / Node test environment).
 */
function getHeapUsedMb(): number {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  if (mem) {
    return mem.usedJSHeapSize / (1024 * 1024);
  }
  return -1;
}

/**
 * Posts a memory_limit_exceeded error and clears all script instances
 * so subsequent ticks are no-ops.
 */
function terminateDueToMemory(heapMb: number) {
  (self as unknown as Worker).postMessage({
    type: 'error',
    entityId: '',
    line: 0,
    message: `Script memory limit exceeded: ${heapMb.toFixed(1)} MB used (limit: ${memoryLimitMb} MB). Scripts terminated.`,
  });
  scripts = [];
}

const MAX_SCRIPT_SOURCE_BYTES = 512 * 1024;

// ─── Infinite Loop Watchdog ──────────────────────────────────────
const DEFAULT_LOOP_ITERATION_LIMIT = 1_000_000;
let loopIterationLimit = DEFAULT_LOOP_ITERATION_LIMIT;
const DEFAULT_ON_START_TIMEOUT_MS = 1000;
const DEFAULT_ON_DESTROY_TIMEOUT_MS = 1000;
let onStartTimeoutMs = DEFAULT_ON_START_TIMEOUT_MS;
let onDestroyTimeoutMs = DEFAULT_ON_DESTROY_TIMEOUT_MS;


function compileScript(entityId_: string, source: string): ScriptInstance {
  const forge = buildForgeApi(entityId_);
  const instance: ScriptInstance = { entityId: entityId_ };

  if (typeof source !== 'string') {
    (self as unknown as Worker).postMessage({ type: 'error', entityId: entityId_, line: 0, message: `Compilation error: script source must be a string` });
    return instance;
  }
  const sourceByteLength = new TextEncoder().encode(source).length;
  if (sourceByteLength > MAX_SCRIPT_SOURCE_BYTES) {
    (self as unknown as Worker).postMessage({ type: 'error', entityId: entityId_, line: 0, message: `Compilation error: script source exceeds maximum allowed size` });
    return instance;
  }

  try {
    // Inject loop guards before compilation to catch infinite loops at the source level.
    // PF-589: guardVarNames lets us generate a __resetGuards() function so that each
    // entry-point call (onStart, onUpdate, onDestroy) starts with all counters at 0,
    // preventing legitimate loops from accumulating iterations across frames.
    const { source: guardedSource, guardVarNames } = injectLoopGuards(source);
    const resetBody = guardVarNames.length > 0
      ? guardVarNames.map(v => v + '=0;').join('')
      : '';
    const resetFn = resetBody ? 'function __resetGuards(){' + resetBody + '}' : 'function __resetGuards(){}';
    // CodeQL: js/code-injection — intentional. This is the script sandbox that executes
    // user-authored game scripts. Multiple security layers protect against abuse:
    // global shadowing, command whitelist, per-frame command limit, infinite loop watchdog,
    // rate limiter. See SEC-2 (Script Sandbox Hardening) in CLAUDE.md.
    // lgtm[js/code-injection]
    // Shadow dangerous globals; sandbox compilation is intentional for script isolation.
    const sandboxCtor = Function; // codeql[js/code-injection]
    const fn = sandboxCtor(
      'forge', 'entityId', '__loopLimit',
      ...SHADOWED_GLOBALS,
      `
      ${guardedSource}
      ${resetFn}
      return {
        onStart: typeof onStart === 'function' ? function(){__resetGuards();onStart();} : undefined,
        onUpdate: typeof onUpdate === 'function' ? function(dt){__resetGuards();onUpdate(dt);} : undefined,
        onDestroy: typeof onDestroy === 'function' ? function(){__resetGuards();onDestroy();} : undefined,
      };
      `
    );
    const result = fn(forge, entityId_, loopIterationLimit, ...SHADOWED_GLOBALS.map(() => undefined));
    instance.onStart = result.onStart;
    instance.onUpdate = result.onUpdate;
    instance.onDestroy = result.onDestroy;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    (self as unknown as Worker).postMessage({ type: 'error', entityId: entityId_, line: 0, message: `Compilation error: ${msg}` });
  }

  return instance;
}

const MAX_COMMANDS_PER_FRAME = 100;

function flushCommands() {
  if (pendingCommands.length > MAX_COMMANDS_PER_FRAME) {
    (self as unknown as Worker).postMessage({
      type: 'error', entityId: '', line: 0,
      message: `Command limit exceeded (${pendingCommands.length}/${MAX_COMMANDS_PER_FRAME} per frame). Extra commands dropped.`,
    });
    pendingCommands = pendingCommands.slice(0, MAX_COMMANDS_PER_FRAME);
  }
  if (pendingCommands.length > 0) {
    (self as unknown as Worker).postMessage({ type: 'commands', commands: pendingCommands });
    pendingCommands = [];
  }
  if (uiDirty) {
    (self as unknown as Worker).postMessage({
      type: 'ui',
      elements: Array.from(uiElements.values()),
    });
    uiDirty = false;
  }
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init': {
      // Initialize scripts
      scripts = [];
      sharedState = {};
      spawnCounter = 0;
      clearPendingAsyncRequests('Script re-initialized');
      entityStates = msg.entities || {};
      entityInfos = msg.entityInfos || {};
      currentInput = msg.inputState || { pressed: {}, justPressed: {}, justReleased: {}, axes: {} };
      tilemapStates = msg.tilemapStates || {};
      skeletonStates = msg.skeletonStates || {};
      physics2dVelocities = msg.physics2dVelocities || {};
      prevEntityStates = {};
      // Main thread passes touch capability so the worker doesn't need navigator access
      isTouchDeviceFlag = typeof msg.isTouchDevice === 'boolean' ? msg.isTouchDevice : false;
      uiElements.clear();
      uiDirty = false;

      for (const s of msg.scripts) {
        if (!s.enabled) continue;
        const instance = compileScript(s.entityId, s.source);
        scripts.push(instance);
      }

      // Call onStart on all scripts with watchdog
      pendingCommands = [];
      const startScriptsToRemove: string[] = [];
      for (const script of scripts) {
        if (script.onStart) {
          const hookStart = performance.now();
          try {
            script.onStart();
          } catch (err) {
            const msg_ = err instanceof Error ? err.message : String(err);
            if (msg_.includes('Infinite loop detected')) {
              (self as unknown as Worker).postMessage({ type: 'script_timeout', entityId: script.entityId, hookName: 'onStart', message: msg_ });
              startScriptsToRemove.push(script.entityId);
            } else {
              (self as unknown as Worker).postMessage({ type: 'error', entityId: script.entityId, line: 0, message: `onStart error: ${msg_}` });
            }
          }
          const hookElapsed = performance.now() - hookStart;
          if (hookElapsed > onStartTimeoutMs && !startScriptsToRemove.includes(script.entityId)) {
            (self as unknown as Worker).postMessage({ type: 'script_timeout', entityId: script.entityId, hookName: 'onStart', message: `onStart exceeded timeout: ${hookElapsed.toFixed(1)} ms (limit: ${onStartTimeoutMs} ms). Script terminated.` });
            startScriptsToRemove.push(script.entityId);
          }
        }
      }
      if (startScriptsToRemove.length > 0) {
        scripts = scripts.filter(s => !startScriptsToRemove.includes(s.entityId));
      }

      flushCommands();
      break;
    }

    case 'tick': {
      // Process async responses before running scripts (so promises resolve)
      if (msg.asyncResponses) {
        processAsyncResponses(msg.asyncResponses);
      }

      timeData.delta = msg.dt ?? 0;
      timeData.elapsed = msg.elapsed ?? 0;

      // Delta encoding support: if entitiesDelta is present, apply it to
      // the current entityStates to reconstruct the full state. This avoids
      // serializing the entire scene every frame.
      let newEntities: Record<string, EntityState>;
      if (msg.entitiesDelta) {
        const delta = msg.entitiesDelta as {
          changed: Record<string, Record<string, unknown>>;
          removed: string[];
          isKeyframe: boolean;
        };
        if (delta.isKeyframe) {
          // Keyframe: changed contains the full state
          newEntities = delta.changed as unknown as Record<string, EntityState>;
        } else {
          // Incremental delta: apply changes to current state
          newEntities = { ...entityStates };
          for (const eid of delta.removed) {
            delete newEntities[eid];
          }
          for (const [eid, components] of Object.entries(delta.changed)) {
            if (!newEntities[eid]) {
              newEntities[eid] = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
            }
            newEntities[eid] = { ...newEntities[eid], ...components } as EntityState;
          }
        }
      } else {
        newEntities = msg.entities || {};
      }

      // Apply entityInfos delta if present
      if (msg.entityInfosDelta) {
        const delta = msg.entityInfosDelta as {
          changed: Record<string, Record<string, unknown>>;
          removed: string[];
          isKeyframe: boolean;
        };
        if (delta.isKeyframe) {
          entityInfos = delta.changed as unknown as Record<string, EntityInfo>;
        } else {
          const updated = { ...entityInfos };
          for (const eid of delta.removed) {
            delete updated[eid];
          }
          for (const [eid, components] of Object.entries(delta.changed)) {
            if (!updated[eid]) {
              updated[eid] = { name: '', type: 'unknown', colliderRadius: 0.5 };
            }
            updated[eid] = { ...updated[eid], ...components } as EntityInfo;
          }
          entityInfos = updated;
        }
      } else if (msg.entityInfos) {
        entityInfos = msg.entityInfos;
      }

      // Estimate 2D velocities from position deltas when engine doesn't provide them
      if (timeData.delta > 0) {
        const newVelocities: Record<string, Physics2dVelocityState> = {};
        const invDt = 1 / timeData.delta;
        for (const [eid, state] of Object.entries(newEntities) as [string, EntityState][]) {
          const prev = prevEntityStates[eid];
          if (prev) {
            newVelocities[eid] = {
              velocity: [
                (state.position[0] - prev.position[0]) * invDt,
                (state.position[1] - prev.position[1]) * invDt,
              ],
              angularVelocity: (state.rotation[2] - prev.rotation[2]) * invDt,
            };
          }
        }
        // Use engine-provided velocities if available, otherwise use estimated
        // Check for undefined specifically since an empty {} is truthy but contains no data
        physics2dVelocities = msg.physics2dVelocities !== undefined && Object.keys(msg.physics2dVelocities).length > 0
          ? msg.physics2dVelocities
          : newVelocities;
      }
      prevEntityStates = { ...newEntities };

      entityStates = newEntities;
      // entityInfos already updated above (delta or full)
      currentInput = msg.inputState || currentInput;
      if (msg.tilemapStates) tilemapStates = msg.tilemapStates;
      if (msg.skeletonStates) skeletonStates = msg.skeletonStates;

      // Sync audio playing state from main thread (authoritative source)
      // Clear stale entries first so destroyed instances don't persist as "playing"
      if (msg.audioPlayingStates) {
        audioPlayingState.clear();
        for (const [eid, playing] of Object.entries(msg.audioPlayingStates)) {
          audioPlayingState.set(eid, playing as boolean);
        }
      }

      // Memory guard — check once per tick before running scripts
      const heapMb = getHeapUsedMb();
      if (heapMb >= 0 && heapMb > memoryLimitMb) {
        terminateDueToMemory(heapMb);
        flushCommands();
        break;
      }

      pendingCommands = [];
      const scriptsToRemove: string[] = [];
      for (const script of scripts) {
        if (script.onUpdate) {
          const frameStart = performance.now();
          try {
            script.onUpdate(timeData.delta);
          } catch (err) {
            const msg_ = err instanceof Error ? err.message : String(err);
            if (msg_.includes('Infinite loop detected')) {
              (self as unknown as Worker).postMessage({ type: 'script_timeout', entityId: script.entityId, hookName: 'onUpdate', message: msg_ });
              scriptsToRemove.push(script.entityId);
              continue;
            }
            (self as unknown as Worker).postMessage({ type: 'error', entityId: script.entityId, line: 0, message: `onUpdate error: ${msg_}` });
          }
          const elapsed = performance.now() - frameStart;
          if (elapsed > frameTimeLimitMs) {
            (self as unknown as Worker).postMessage({
              type: 'error',
              entityId: script.entityId,
              line: 0,
              message: `Script frame time limit exceeded: ${elapsed.toFixed(1)} ms (limit: ${frameTimeLimitMs} ms). Script '${script.entityId}' terminated.`,
            });
            scriptsToRemove.push(script.entityId);
          } else if (elapsed > frameTimeWarnMs) {
            (self as unknown as Worker).postMessage({
              type: 'log',
              level: 'warn',
              entityId: script.entityId,
              message: `Script onUpdate took ${elapsed.toFixed(1)} ms (budget: ${frameTimeWarnMs} ms).`,
            });
          }
        }
      }
      if (scriptsToRemove.length > 0) {
        scripts = scripts.filter(s => !scriptsToRemove.includes(s.entityId));
      }

      flushCommands();
      break;
    }

    case 'stop': {
      clearPendingAsyncRequests('Script execution stopped');
      for (const script of scripts) {
        if (script.onDestroy) {
          const destroyStart = performance.now();
          let destroyHandled = false;
          try {
            script.onDestroy();
          } catch (err) {
            const msg_ = err instanceof Error ? err.message : String(err);
            if (msg_.includes('Infinite loop detected')) {
              (self as unknown as Worker).postMessage({ type: 'script_timeout', entityId: script.entityId, hookName: 'onDestroy', message: msg_ });
              destroyHandled = true;
            } else {
              (self as unknown as Worker).postMessage({ type: 'error', entityId: script.entityId, line: 0, message: `onDestroy error: ${msg_}` });
            }
          }
          const destroyElapsed = performance.now() - destroyStart;
          if (!destroyHandled && destroyElapsed > onDestroyTimeoutMs) {
            (self as unknown as Worker).postMessage({ type: 'script_timeout', entityId: script.entityId, hookName: 'onDestroy', message: `onDestroy exceeded timeout: ${destroyElapsed.toFixed(1)} ms (limit: ${onDestroyTimeoutMs} ms). Script terminated.` });
          }
        }
      }
      scripts = [];
      sharedState = {};
      collisionEnterCallbacks.clear();
      collisionExitCallbacks.clear();
      // Send final UI clear
      (self as unknown as Worker).postMessage({ type: 'ui', elements: [] });
      break;
    }

    case 'COLLISION_EVENT': {
      const { entityA, entityB, started } = msg;
      const callbacks = started ? collisionEnterCallbacks : collisionExitCallbacks;
      // Fire callback for entityA if registered
      const cbA = callbacks.get(entityA);
      if (cbA) {
        try {
          cbA(entityB);
        } catch (err) {
          const msg_ = err instanceof Error ? err.message : String(err);
          (self as unknown as Worker).postMessage({ type: 'error', entityId: entityA, line: 0, message: `Collision callback error: ${msg_}` });
        }
      }
      // Fire callback for entityB if registered
      const cbB = callbacks.get(entityB);
      if (cbB) {
        try {
          cbB(entityA);
        } catch (err) {
          const msg_ = err instanceof Error ? err.message : String(err);
          (self as unknown as Worker).postMessage({ type: 'error', entityId: entityB, line: 0, message: `Collision callback error: ${msg_}` });
        }
      }
      break;
    }

    case 'scene_info': {
      (self as unknown as Record<string, unknown>).__currentScene = msg.currentScene;
      (self as unknown as Record<string, unknown>).__allSceneNames = msg.allSceneNames;
      break;
    }

    case 'set_limits': {
      // Allows tests (and advanced tooling) to override resource limits at runtime.
      if (typeof msg.memoryLimitMb === 'number') memoryLimitMb = msg.memoryLimitMb;
      if (typeof msg.frameTimeLimitMs === 'number') frameTimeLimitMs = msg.frameTimeLimitMs;
      if (typeof msg.frameTimeWarnMs === 'number') frameTimeWarnMs = msg.frameTimeWarnMs;
      if (typeof msg.loopIterationLimit === 'number') loopIterationLimit = msg.loopIterationLimit;
      if (typeof msg.onStartTimeoutMs === 'number') onStartTimeoutMs = msg.onStartTimeoutMs;
      if (typeof msg.onDestroyTimeoutMs === 'number') onDestroyTimeoutMs = msg.onDestroyTimeoutMs;
      break;
    }
  }
};
