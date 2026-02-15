import type { ScriptData } from '@/stores/editorStore';

interface BundledScripts {
  /** The complete JS bundle as a string */
  code: string;
  /** Number of scripts included */
  count: number;
}

/**
 * Bundle all entity scripts into a self-contained JS file for export.
 * Each script is wrapped in a closure with its entity ID.
 * The bundle includes a minimal forge.* API runtime.
 */
export function bundleScripts(
  allScripts: Record<string, ScriptData>
): BundledScripts {
  const enabledScripts = Object.entries(allScripts).filter(([, s]) => s.enabled);

  if (enabledScripts.length === 0) {
    return { code: '', count: 0 };
  }

  // Build the runtime harness + per-entity script wrappers
  const code = `
// Project Forge - Script Bundle
(function() {
  const scripts = {};
  const scriptState = {};

  // Minimal forge API (commands are queued and sent to WASM each frame)
  const pendingCommands = [];

  const forge = {
    log: function(msg) { console.log('[Script] ' + msg); },
    warn: function(msg) { console.warn('[Script] ' + msg); },
    error: function(msg) { console.error('[Script] ' + msg); },
    state: {
      _data: {},
      get: function(key) { return this._data[key]; },
      set: function(key, value) { this._data[key] = value; },
    },
    input: {
      isPressed: function(action) { return window.__forgeInputState?.[action]?.pressed || false; },
      justPressed: function(action) { return window.__forgeInputState?.[action]?.just_pressed || false; },
      justReleased: function(action) { return window.__forgeInputState?.[action]?.just_released || false; },
      getAxis: function(action) { return window.__forgeInputState?.[action]?.axis_value || 0; },
    },
    audio: {
      play: function(id) { pendingCommands.push({cmd: 'play_audio', entityId: id}); },
      stop: function(id) { pendingCommands.push({cmd: 'stop_audio', entityId: id}); },
      pause: function(id) { pendingCommands.push({cmd: 'pause_audio', entityId: id}); },
      setVolume: function(id, v) { pendingCommands.push({cmd: 'set_audio', entityId: id, volume: v}); },
      setPitch: function(id, p) { pendingCommands.push({cmd: 'set_audio', entityId: id, pitch: p}); },
      isPlaying: function(id) { return false; }, // TODO: query from runtime
    },
    physics: {
      applyForce: function(id, x, y, z) { pendingCommands.push({cmd: 'apply_force', entityId: id, force: [x,y,z]}); },
      applyImpulse: function(id, x, y, z) { pendingCommands.push({cmd: 'apply_impulse', entityId: id, impulse: [x,y,z]}); },
      applyTorque: function(id, x, y, z) { pendingCommands.push({cmd: 'apply_torque', entityId: id, torque: [x,y,z]}); },
    },
    getTransform: function(id) { return window.__forgeTransforms?.[id] || {position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}; },
    setPosition: function(id, x, y, z) { pendingCommands.push({cmd: 'update_transform', entityId: id, position: [x,y,z]}); },
    setRotation: function(id, rx, ry, rz) { pendingCommands.push({cmd: 'update_transform', entityId: id, rotation: [rx,ry,rz]}); },
    translate: function(id, dx, dy, dz) {
      const t = this.getTransform(id);
      this.setPosition(id, t.position[0]+dx, t.position[1]+dy, t.position[2]+dz);
    },
    rotate: function(id, drx, dry, drz) {
      const t = this.getTransform(id);
      this.setRotation(id, t.rotation[0]+drx, t.rotation[1]+dry, t.rotation[2]+drz);
    },
  };

  // Flush commands to WASM engine
  window.__forgeFlushCommands = function() {
    const cmds = pendingCommands.splice(0);
    return cmds;
  };

  // Register entity scripts (JSON-encoded to prevent closure breakout)
${enabledScripts.map(([entityId, script]) => `
  scripts['${entityId}'] = (function(forge) {
    const src = ${JSON.stringify(script.source)};
    const fn = new Function('forge', src + '; return { onStart: typeof onStart === "function" ? onStart : null, onUpdate: typeof onUpdate === "function" ? onUpdate : null, onDestroy: typeof onDestroy === "function" ? onDestroy : null };');
    return fn(forge);
  })(forge);
`).join('\n')}

  // Lifecycle management
  window.__forgeScriptStart = function() {
    for (const [id, s] of Object.entries(scripts)) {
      try { if (s.onStart) s.onStart(); } catch(e) { console.error('[Script ' + id + '] onStart error:', e); }
    }
  };

  window.__forgeScriptUpdate = function(dt) {
    for (const [id, s] of Object.entries(scripts)) {
      try { if (s.onUpdate) s.onUpdate(dt); } catch(e) { console.error('[Script ' + id + '] onUpdate error:', e); }
    }
  };

  window.__forgeScriptDestroy = function() {
    for (const [id, s] of Object.entries(scripts)) {
      try { if (s.onDestroy) s.onDestroy(); } catch(e) { console.error('[Script ' + id + '] onDestroy error:', e); }
    }
  };
})();
`;

  return { code, count: enabledScripts.length };
}
