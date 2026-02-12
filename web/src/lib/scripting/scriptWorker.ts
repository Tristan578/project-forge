// Web Worker for sandboxed script execution.
// Receives: init (scripts + entity states), tick (dt + states), stop
// Sends: commands (engine commands), log (console output), error (runtime errors)

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

// Accumulated commands from forge.* calls
let pendingCommands: EngineCommand[] = [];
let entityStates: Record<string, EntityState> = {};
let currentInput: InputState = { pressed: {}, justPressed: {}, justReleased: {}, axes: {} };
let timeData = { delta: 0, elapsed: 0 };
let sharedState: Record<string, unknown> = {};
let scripts: ScriptInstance[] = [];
let spawnCounter = 0;

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
        // In worker, we don't have access to audioManager state — return false
        // Real state tracking would need to be sent from main thread
        return false;
      },
      setBusVolume: (busName: string, volume: number) => {
        pendingCommands.push({ cmd: 'update_audio_bus', busName, volume });
      },
      muteBus: (busName: string, muted: boolean) => {
        pendingCommands.push({ cmd: 'update_audio_bus', busName, muted });
      },
      getBusVolume: (_busName: string) => {
        // In worker, we don't have access to audioManager state
        return 1.0;
      },
      isBusMuted: (_busName: string) => {
        // In worker, we don't have access to audioManager state
        return false;
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

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init': {
      // Initialize scripts
      scripts = [];
      sharedState = {};
      spawnCounter = 0;
      entityStates = msg.entities || {};
      currentInput = msg.inputState || { pressed: {}, justPressed: {}, justReleased: {}, axes: {} };

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

      // Send any commands from onStart
      if (pendingCommands.length > 0) {
        (self as unknown as Worker).postMessage({ type: 'commands', commands: pendingCommands });
        pendingCommands = [];
      }
      break;
    }

    case 'tick': {
      timeData.delta = msg.dt || 0;
      timeData.elapsed = msg.elapsed || 0;
      entityStates = msg.entities || {};
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

      if (pendingCommands.length > 0) {
        (self as unknown as Worker).postMessage({ type: 'commands', commands: pendingCommands });
        pendingCommands = [];
      }
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
      break;
    }
  }
};
