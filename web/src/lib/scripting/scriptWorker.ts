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
    },

    input: {
      isPressed: (action: string) => !!currentInput.pressed[action],
      justPressed: (action: string) => !!currentInput.justPressed[action],
      justReleased: (action: string) => !!currentInput.justReleased[action],
      getAxis: (action: string) => currentInput.axes[action] ?? 0,
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
    },

    time: {
      get delta() { return timeData.delta; },
      get elapsed() { return timeData.elapsed; },
    },
    state: {
      get: (key: string) => sharedState[key],
      set: (key: string, value: unknown) => { sharedState[key] = value; },
    },
  };
}

function compileScript(entityId_: string, source: string): ScriptInstance {
  const forge = buildForgeApi(entityId_);
  const instance: ScriptInstance = { entityId: entityId_ };

  try {
    // Create a function that has access to forge and entityId
    const fn = new Function('forge', 'entityId', `
      ${source}
      return { onStart: typeof onStart === 'function' ? onStart : undefined, onUpdate: typeof onUpdate === 'function' ? onUpdate : undefined, onDestroy: typeof onDestroy === 'function' ? onDestroy : undefined };
    `);
    const result = fn(forge, entityId_);
    instance.onStart = result.onStart;
    instance.onUpdate = result.onUpdate;
    instance.onDestroy = result.onDestroy;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    (self as unknown as Worker).postMessage({ type: 'error', entityId: entityId_, line: 0, message: `Compilation error: ${msg}` });
  }

  return instance;
}

function flushCommands() {
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
  }
};
