// Web Worker for sandboxed script execution.
// Receives: init (scripts + entity states), tick (dt + states), stop
// Sends: commands (engine commands), log (console output), error (runtime errors), ui (HUD updates)

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

// Accumulated commands from forge.* calls
let pendingCommands: EngineCommand[] = [];
let entityStates: Record<string, EntityState> = {};
let entityInfos: Record<string, EntityInfo> = {};
let currentInput: InputState = { pressed: {}, justPressed: {}, justReleased: {}, axes: {} };
const timeData = { delta: 0, elapsed: 0 };
let sharedState: Record<string, unknown> = {};
let scripts: ScriptInstance[] = [];
let spawnCounter = 0;
const uiElements: Map<string, UIElement> = new Map();
let uiDirty = false;

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
        // In web worker context, check for touch support
        return typeof self !== 'undefined' && ('ontouchstart' in self || (navigator && navigator.maxTouchPoints > 0));
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
      getVelocity: (_eid: string) => {
        // Would need state tracking from engine
        return null;
      },
      setAngularVelocity: (eid: string, omega: number) => {
        pendingCommands.push({ cmd: 'set_angular_velocity2d', entityId: eid, omega });
      },
      getAngularVelocity: (_eid: string) => {
        // Would need state tracking from engine
        return null;
      },
      raycast: async (_originX: number, _originY: number, _dirX: number, _dirY: number, _maxDistance?: number) => {
        // TODO: Implement raycast2d with request/response pattern when engine supports it
        return Promise.resolve(null);
      },
      isGrounded: async (_eid: string, _distance?: number) => {
        // TODO: Implement isGrounded when raycast2d is available
        return Promise.resolve(false);
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
      listClips: (_eid: string) => {
        // In worker, we don't have access to animation registry — return empty
        return [] as string[];
      },
    },
    tilemap: {
      getTile: (_tilemapId: string, _x: number, _y: number, _layer = 0) => {
        // Read from entity cache/store (would need tilemap state synced)
        // For now, return null until tilemap state is synced to worker
        // TODO: Sync tilemap data to worker and use parameters
        return null;
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
      worldToTile: (_tilemapId: string, worldX: number, worldY: number): [number, number] => {
        // Pure math conversion (would need tilemap data for tile size and origin)
        // For now, assume 32x32 tiles and top-left origin
        // TODO: Use actual tilemap tile size from synced data
        const tileX = Math.floor(worldX / 32);
        const tileY = Math.floor(-worldY / 32);
        return [tileX, tileY];
      },
      tileToWorld: (_tilemapId: string, tileX: number, tileY: number): [number, number] => {
        // Pure math conversion
        // TODO: Use actual tilemap tile size from synced data
        const worldX = tileX * 32;
        const worldY = -tileY * 32;
        return [worldX, worldY];
      },
      getMapSize: (_tilemapId: string): [number, number] => {
        // Would need tilemap data synced to worker
        // TODO: Sync tilemap data to worker
        return [0, 0];
      },
      resize: (tilemapId: string, width: number, height: number, anchor = 'top-left') => {
        pendingCommands.push({ cmd: 'resize_tilemap', tilemapId, width, height, anchor });
      },
    },
    audio: {
      play: (eid: string) => {
        pendingCommands.push({ cmd: 'play_audio', entityId: eid });
      },
      stop: (eid: string) => {
        pendingCommands.push({ cmd: 'stop_audio', entityId: eid });
      },
      pause: (eid: string) => {
        pendingCommands.push({ cmd: 'pause_audio', entityId: eid });
      },
      setVolume: (eid: string, volume: number) => {
        pendingCommands.push({ cmd: 'set_audio', entityId: eid, volume });
      },
      setPitch: (eid: string, pitch: number) => {
        pendingCommands.push({ cmd: 'set_audio', entityId: eid, pitch });
      },
      isPlaying: (_eid: string) => {
        return false;
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
      getBones: (_eid: string) => {
        // Would need to be populated from engine state
        return null;
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
      getSkin: (_eid: string) => {
        // Would need to be populated from engine state
        return null;
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
      getBones: (_eid: string) => {
        // TODO: sync skeleton state to worker
        return null;
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
  };
}

// Globals to shadow in user scripts for sandbox isolation
const SHADOWED_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
  'indexedDB', 'caches', 'navigator', 'location',
  'EventSource', 'BroadcastChannel',
] as const;

function compileScript(entityId_: string, source: string): ScriptInstance {
  const forge = buildForgeApi(entityId_);
  const instance: ScriptInstance = { entityId: entityId_ };

  try {
    // Shadow dangerous globals to prevent network access from user scripts
    const fn = new Function(
      'forge', 'entityId',
      ...SHADOWED_GLOBALS,
      `
      ${source}
      return { onStart: typeof onStart === 'function' ? onStart : undefined, onUpdate: typeof onUpdate === 'function' ? onUpdate : undefined, onDestroy: typeof onDestroy === 'function' ? onDestroy : undefined };
      `
    );
    // Pass undefined for all shadowed globals
    const result = fn(forge, entityId_, ...SHADOWED_GLOBALS.map(() => undefined));
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
      entityStates = msg.entities || {};
      entityInfos = msg.entityInfos || {};
      currentInput = msg.inputState || { pressed: {}, justPressed: {}, justReleased: {}, axes: {} };
      uiElements.clear();
      uiDirty = false;

      for (const s of msg.scripts) {
        if (!s.enabled) continue;
        const instance = compileScript(s.entityId, s.source);
        scripts.push(instance);
      }

      // Call onStart on all scripts
      pendingCommands = [];
      for (const script of scripts) {
        if (script.onStart) {
          try {
            script.onStart();
          } catch (err) {
            const msg_ = err instanceof Error ? err.message : String(err);
            (self as unknown as Worker).postMessage({ type: 'error', entityId: script.entityId, line: 0, message: `onStart error: ${msg_}` });
          }
        }
      }

      flushCommands();
      break;
    }

    case 'tick': {
      timeData.delta = msg.dt || 0;
      timeData.elapsed = msg.elapsed || 0;
      entityStates = msg.entities || {};
      entityInfos = msg.entityInfos || entityInfos;
      currentInput = msg.inputState || currentInput;

      pendingCommands = [];
      for (const script of scripts) {
        if (script.onUpdate) {
          try {
            script.onUpdate(timeData.delta);
          } catch (err) {
            const msg_ = err instanceof Error ? err.message : String(err);
            (self as unknown as Worker).postMessage({ type: 'error', entityId: script.entityId, line: 0, message: `onUpdate error: ${msg_}` });
          }
        }
      }

      flushCommands();
      break;
    }

    case 'stop': {
      for (const script of scripts) {
        if (script.onDestroy) {
          try {
            script.onDestroy();
          } catch (err) {
            const msg_ = err instanceof Error ? err.message : String(err);
            (self as unknown as Worker).postMessage({ type: 'error', entityId: script.entityId, line: 0, message: `onDestroy error: ${msg_}` });
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
  }
};
