import { describe, it, expect } from 'vitest';
import { generateGameLoopFragment } from '../gameLoopFragment';
import { MAX_COMMAND_PAYLOAD_DEPTH, MAX_COMMAND_PAYLOAD_CONTAINERS } from '@/lib/engine/commandPayloadGuard';

/**
 * Single source-of-truth test for the exported game loop (#8761). Previously the
 * single-HTML and ZIP exporters each carried a near-duplicate structural test;
 * the loop now lives in one helper, so its invariants are pinned here once.
 */
describe('generateGameLoopFragment', () => {
  const frag = generateGameLoopFragment({ handleCommand: 'handle_command' });

  it('emits the loop scaffold from lastTime capture through the rAF kickoff', () => {
    expect(frag).toContain('var lastTime = performance.now();');
    expect(frag).toContain('function gameLoop() {');
    expect(frag).toContain('var dt = (now - lastTime) / 1000;');
    // rAF appears twice: the in-loop re-enqueue and the initial kickoff.
    expect(frag.match(/requestAnimationFrame\(gameLoop\)/g)).toHaveLength(2);
  });

  it('merges touch input BEFORE the script update every frame (#8754 ordering invariant)', () => {
    const touchMerge = frag.indexOf('window.__forgeTouchFlush()');
    const scriptUpdate = frag.indexOf('window.__forgeScriptUpdate(dt)');
    expect(touchMerge).toBeGreaterThan(-1);
    expect(scriptUpdate).toBeGreaterThan(-1);
    // If this ever flips, an intervening PLAY_TICK wipes touch state before any
    // script reads it and touch controls go dead in exported mobile games.
    expect(touchMerge).toBeLessThan(scriptUpdate);
  });

  it('re-applies the full touch surface (pressed / justPressed / justReleased / axes) on top of PLAY_TICK', () => {
    expect(frag).toContain('for (var k in ti.pressed)');
    expect(frag).toContain('for (var k2 in ti.justPressed)');
    expect(frag).toContain('for (var k3 in ti.justReleased)');
    expect(frag).toContain('for (var k4 in ti.axes)');
  });

  /**
   * Run the emitted loop for exactly one frame against a stub engine and
   * return what the sink received. The fragment's kickoff `requestAnimationFrame`
   * hands us `gameLoop`; a second call is never made because the stub rAF
   * only captures.
   */
  function runOneFrame(commands: Array<Record<string, unknown>>, sink: (name: string, payload: unknown) => unknown) {
    const source = generateGameLoopFragment({ handleCommand: 'handle_command' });
    const win: Record<string, unknown> = { __forgeFlushCommands: () => commands };
    const warnings: string[] = [];
    let loop: (() => void) | undefined;
    const run = new Function(
      'window', 'performance', 'requestAnimationFrame', 'handle_command', 'console',
      `${source}\nreturn gameLoop;`,
    ) as (...args: unknown[]) => () => void;
    loop = run(
      win,
      { now: () => 0 },
      (cb: () => void) => { loop = cb; },
      sink,
      { warn: (msg: string) => { warnings.push(msg); } },
    );
    loop();
    return warnings;
  }

  it('flushes each queued script command as the command OBJECT, name split off (#10196)', () => {
    const calls: Array<[string, unknown]> = [];
    const queued = { cmd: 'apply_force', entityId: 'e1', force: [0, 5, 0], isImpulse: true };
    runOneFrame([queued], (name, payload) => { calls.push([name, payload]); return { success: true }; });

    expect(calls).toEqual([['apply_force', { entityId: 'e1', force: [0, 5, 0], isImpulse: true }]]);
    // The engine deserialises the JS value it is handed: a JSON STRING would
    // arrive as one string with no fields, which every handler refuses.
    expect(typeof calls[0][1]).toBe('object');
    expect(frag).not.toContain('JSON.stringify(cmds[ci])');
  });

  it('warns once per command name when the engine refuses a script command', () => {
    const refuse = () => ({ success: false, error: 'Invalid apply_force payload' });
    const warnings = runOneFrame(
      [{ cmd: 'apply_force', entityId: 'e1' }, { cmd: 'apply_force', entityId: 'e2' }, { cmd: 'play_audio', entityId: 'e1' }],
      refuse,
    );
    expect(warnings).toEqual([
      '[SpawnForge] The engine refused script command "apply_force": Invalid apply_force payload',
      '[SpawnForge] The engine refused script command "play_audio": Invalid apply_force payload',
    ]);
  });

  it('stays silent for accepted commands and for a sink that returns nothing', () => {
    expect(runOneFrame([{ cmd: 'stop' }], () => undefined)).toEqual([]);
    expect(runOneFrame([{ cmd: 'stop' }], () => ({ success: true }))).toEqual([]);
  });

  it('drops a script command nested deeper than the editor payload guard allows, once-warned', () => {
    // One wrapper past the bound: { leaf: 1 } is depth 2, plus MAX - 1
    // wrappers, so the spread payload { entityId, a: ... } is depth MAX + 1.
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < MAX_COMMAND_PAYLOAD_DEPTH - 1; i++) deep = { a: deep };
    const calls: string[] = [];
    const warnings = runOneFrame(
      [{ cmd: 'update_transform', entityId: 'e1', ...deep }, { cmd: 'update_transform', entityId: 'e1', ...deep }, { cmd: 'stop' }],
      (name) => { calls.push(name); return { success: true }; },
    );
    expect(calls).toEqual(['stop']);
    expect(warnings).toEqual([
      `[SpawnForge] Dropped script command "update_transform": payload nested deeper than ${MAX_COMMAND_PAYLOAD_DEPTH} levels`,
    ]);
  });

  it('forwards a script command exactly at the depth bound', () => {
    // The payload { a: atBound } must be depth MAX, so atBound is MAX - 1:
    // { leaf: 1 } is depth 2, plus MAX - 3 wrappers.
    let atBound: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < MAX_COMMAND_PAYLOAD_DEPTH - 3; i++) atBound = { a: atBound };
    const calls: string[] = [];
    runOneFrame([{ cmd: 'update_transform', a: atBound }], (name) => { calls.push(name); return { success: true }; });
    expect(calls).toEqual(['update_transform']);
  });

  it('forwards an EMPTY container exactly at the depth bound, as the editor guard does', () => {
    // The old recursive guard refused an empty object at depth MAX because it
    // tested `remaining <= 1` before looking at the children; the editor's
    // iterative guard accepts it (32 > 32 is false), and so does this one.
    let empty: Record<string, unknown> = {};
    for (let i = 0; i < MAX_COMMAND_PAYLOAD_DEPTH - 2; i++) empty = { a: empty };
    const calls: string[] = [];
    const warnings = runOneFrame([{ cmd: 'update_transform', a: empty }], (name) => { calls.push(name); return { success: true }; });
    expect(calls).toEqual(['update_transform']);
    expect(warnings).toEqual([]);
  });

  it('drops a script command whose depth hides inside a Map or Set, as the editor guard would', () => {
    // A Map's contents are not own enumerable properties, so a for-in walk
    // reported depth 1 for this while the engine's deserialiser recursed
    // through every level.
    let deep: unknown = { leaf: 1 };
    for (let i = 0; i < MAX_COMMAND_PAYLOAD_DEPTH - 1; i++) deep = { a: deep };
    const viaMap = new Map<string, unknown>([['k', deep]]);
    const viaSet = new Set<unknown>([deep]);
    const calls: string[] = [];
    const warnings = runOneFrame(
      [{ cmd: 'update_transform', m: viaMap }, { cmd: 'update_material', s: viaSet }, { cmd: 'stop' }],
      (name) => { calls.push(name); return { success: true }; },
    );
    expect(calls).toEqual(['stop']);
    expect(warnings).toEqual([
      `[SpawnForge] Dropped script command "update_transform": payload nested deeper than ${MAX_COMMAND_PAYLOAD_DEPTH} levels`,
      `[SpawnForge] Dropped script command "update_material": payload nested deeper than ${MAX_COMMAND_PAYLOAD_DEPTH} levels`,
    ]);
  });

  it('drops a shallow script command that carries more containers than the editor guard allows', () => {
    // The payload itself is one container; MAX more wide, shallow objects
    // push it one over the bound, and MAX - 1 sit exactly on it.
    const over = { cmd: 'set_tilemap', cells: Array.from({ length: MAX_COMMAND_PAYLOAD_CONTAINERS }, () => ({})) };
    const atBound = { cmd: 'set_tilemap', cells: Array.from({ length: MAX_COMMAND_PAYLOAD_CONTAINERS - 2 }, () => ({})) };
    const calls: string[] = [];
    const warnings = runOneFrame([over, atBound], (name) => { calls.push(name); return { success: true }; });
    expect(calls).toEqual(['set_tilemap']);
    expect(warnings).toEqual([
      `[SpawnForge] Dropped script command "set_tilemap": payload has too much structure (over ${MAX_COMMAND_PAYLOAD_CONTAINERS} objects and arrays)`,
    ]);
  });

  it('copies only the command\'s own fields, and never lets __proto__ rewrite the payload prototype', () => {
    // JSON.parse yields an OWN enumerable "__proto__" key; assigning it onto
    // a plain object would swap that object's prototype, so the engine would
    // serialise inherited fields in place of the command's own.
    const polluted = JSON.parse('{"cmd":"apply_force","__proto__":{"entityId":"victim"},"force":[0,1,0]}') as Record<string, unknown>;
    const inherited = Object.create({ entityId: 'from-prototype' }) as Record<string, unknown>;
    inherited.cmd = 'apply_force';
    inherited.force = [1, 0, 0];
    const payloads: unknown[] = [];
    runOneFrame([polluted, inherited], (_name, payload) => { payloads.push(payload); return { success: true }; });

    expect(payloads).toEqual([{ force: [0, 1, 0] }, { force: [1, 0, 0] }]);
    for (const payload of payloads) {
      expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
      expect('entityId' in (payload as object)).toBe(false);
    }
  });

  it('parameterizes the command sink (ZIP build uses the wasm module local)', () => {
    const zipFrag = generateGameLoopFragment({ handleCommand: 'wasm.handle_command' });
    expect(zipFrag).toContain('wasm.handle_command(cmdName, cmdPayload);');
    expect(frag).toContain('handle_command(cmdName, cmdPayload);');
    // The two builds must differ ONLY in the sink reference — same loop otherwise.
    expect(zipFrag.replace(/wasm\.handle_command/g, 'handle_command')).toBe(frag);
  });

  it('applies the indent prefix to every non-blank line and leaves blank lines bare', () => {
    const indented = generateGameLoopFragment({ handleCommand: 'handle_command', indent: '    ' });
    const lines = indented.split('\n');
    for (const line of lines) {
      if (line.length === 0) continue;
      expect(line.startsWith('    ')).toBe(true);
    }
    // Blank separator lines stay genuinely empty (no trailing whitespace).
    expect(indented).toContain('\n\n');
  });
});

describe('generateGameLoopFragment perf harness hook (#10013)', () => {
  const frag = generateGameLoopFragment({ handleCommand: 'handle_command' });

  it('hands each frame timestamp to the harness, guarded, before any per-frame work', () => {
    const hook = frag.indexOf('if (window.__forgePerfHooks) window.__forgePerfHooks.frame(now);');
    expect(hook).toBeGreaterThan(frag.indexOf('lastTime = now;'));
    expect(hook).toBeLessThan(frag.indexOf('window.__forgeScriptUpdate(dt)'));
  });

  it('calls the hook with the same clock the loop uses for dt', () => {
    const run = new Function('window', 'performance', 'requestAnimationFrame', `${frag}\nreturn gameLoop;`);
    const seen: number[] = [];
    let clock = 100;
    const loop = run(
      { __forgePerfHooks: { frame: (now: number) => seen.push(now) } },
      { now: () => (clock += 16) },
      () => undefined,
    ) as () => void;
    loop();
    loop();
    expect(seen).toEqual([132, 148]);
  });
});
