/**
 * The engine answers every command with a CommandResponse, and 33 commands
 * reject by design. Until PF-1098 that answer was discarded at the first hop,
 * so a rejected command was indistinguishable from a successful one at every
 * one of the ~40 single-dispatch call sites. `setCommandDispatcher`'s tracked
 * wrapper is the single point they all pass through, so the detection lives
 * there rather than in each caller.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/monitoring/sentry-client', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setTag: vi.fn(),
  withScope: vi.fn(),
  startSpan: vi.fn((_opts: unknown, cb: () => unknown) => cb()),
  initSentryClient: vi.fn(),
}));

vi.mock('@/lib/analytics/events', () => ({
  trackCommandDispatched: vi.fn(),
}));

async function loadStore() {
  vi.resetModules();
  const store = await import('../editorStore');
  const sentry = await import('@/lib/monitoring/sentry-client');
  return { store, sentry };
}

describe('engine command rejection reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports a rejected command, naming the command and the engine error', async () => {
    const { store, sentry } = await loadStore();
    store.setCommandDispatcher(() => ({ success: false, error: 'Not yet implemented: switch_scene' }));

    store.getCommandDispatcher()?.('switch_scene', { id: 'a' });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('switch_scene'),
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Not yet implemented: switch_scene'),
    );
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const [err, context] = vi.mocked(sentry.captureException).mock.calls[0];
    expect((err as Error).message).toContain('switch_scene');
    // Whole-object, not a subset: what this context carries is the thing under
    // test, and a subset assertion is blind to a field invented alongside it.
    expect(context).toEqual({
      command: 'switch_scene',
      engineError: 'Not yet implemented: switch_scene',
    });
  });

  it('says so explicitly when the engine rejects without an error message', async () => {
    const { store, sentry } = await loadStore();
    store.setCommandDispatcher(() => ({ success: false }));

    store.getCommandDispatcher()?.('spawn_entity', {});

    const [, context] = vi.mocked(sentry.captureException).mock.calls[0];
    expect((context as Record<string, unknown>).engineError).toBe('no error message');
  });

  it('does not report a successful command', async () => {
    const { store, sentry } = await loadStore();
    store.setCommandDispatcher(() => ({ success: true }));

    store.getCommandDispatcher()?.('spawn_entity', {});

    expect(console.error).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('does not report when the dispatcher returns nothing', async () => {
    // A dispatcher predating PF-1098 (and every test double) returns undefined.
    // Absence of a response is not evidence of rejection — only an explicit
    // `success: false` is, or the gate would fire on every mocked dispatch.
    const { store, sentry } = await loadStore();
    store.setCommandDispatcher(() => undefined);

    store.getCommandDispatcher()?.('spawn_entity', {});

    expect(console.error).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('returns the engine response to the caller', async () => {
    const { store } = await loadStore();
    const response = { success: false, error: 'Not yet implemented: create_scene' };
    store.setCommandDispatcher(() => response);

    expect(store.getCommandDispatcher()?.('create_scene', {})).toEqual(response);
  });

  it('reports a repeated rejection to the console every time but to Sentry once', async () => {
    // A rejection inside a per-frame dispatch would otherwise flood the issue
    // stream; the console signal stays unthrottled so local debugging is honest.
    const { store, sentry } = await loadStore();
    store.setCommandDispatcher(() => ({ success: false, error: 'nope' }));

    const dispatch = store.getCommandDispatcher();
    dispatch?.('save_scene', {});
    dispatch?.('save_scene', {});
    dispatch?.('save_scene', {});

    expect(console.error).toHaveBeenCalledTimes(3);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('reports each distinct rejected command to Sentry', async () => {
    const { store, sentry } = await loadStore();
    store.setCommandDispatcher((command) => ({ success: false, error: `no ${command}` }));

    const dispatch = store.getCommandDispatcher();
    dispatch?.('save_scene', {});
    dispatch?.('delete_scene', {});

    expect(sentry.captureException).toHaveBeenCalledTimes(2);
  });

  it('still dispatches and still returns when reporting throws', async () => {
    const { store, sentry } = await loadStore();
    vi.mocked(sentry.captureException).mockImplementation(() => {
      throw new Error('Sentry is down');
    });
    const dispatcher = vi.fn(() => ({ success: false, error: 'nope' }));
    store.setCommandDispatcher(dispatcher);

    expect(() => store.getCommandDispatcher()?.('save_scene', {})).not.toThrow();
    expect(dispatcher).toHaveBeenCalledWith('save_scene', {});
  });

  it('records a rejected command in the crash-diagnostics ring', async () => {
    const { store } = await loadStore();
    store.setCommandDispatcher(() => ({ success: false, error: 'nope' }));

    store.getCommandDispatcher()?.('save_scene', {});

    expect(store.getRecentCommands()).toContain('save_scene');
  });
});

/**
 * The same wrapper is where an oversized payload has to be stopped. The engine
 * bounds depth and node count too, but on the wasm path its guard runs after
 * `serde_wasm_bindgen` has already walked the value recursively to build it —
 * and overflowing that walk is an unrecoverable trap, not an error (PF-1149).
 */
describe('oversized command payloads are refused before reaching the engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Built iteratively — a recursive helper would overflow building the input. */
  function nested(levels: number): unknown {
    let value: unknown = 1;
    for (let i = 0; i < levels; i += 1) value = { a: value };
    return value;
  }

  it('never calls the dispatcher with a payload deep enough to trap the engine', async () => {
    const { store } = await loadStore();
    const dispatcher = vi.fn(() => ({ success: true }));
    store.setCommandDispatcher(dispatcher);

    const response = store.getCommandDispatcher()?.('update_physics', nested(10_000));

    expect(dispatcher).not.toHaveBeenCalled();
    // The whole response, not a subset: `toMatchObject` would pass just as
    // happily on a shape carrying fields the callers never expect.
    expect(response).toEqual({
      success: false,
      error: expect.stringContaining('nested too deeply'),
    });
  });

  it('reports the refusal so it is not a silent no-op', async () => {
    const { store, sentry } = await loadStore();
    store.setCommandDispatcher(() => ({ success: true }));

    store.getCommandDispatcher()?.('update_physics', nested(10_000));

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('update_physics'));
  });

  it('still dispatches a normal payload', async () => {
    const { store } = await loadStore();
    const dispatcher = vi.fn(() => ({ success: true }));
    store.setCommandDispatcher(dispatcher);

    store.getCommandDispatcher()?.('update_physics', { entityId: 'e1', mass: 2 });

    expect(dispatcher).toHaveBeenCalledWith('update_physics', { entityId: 'e1', mass: 2 });
  });

  it('refuses an oversized batch and answers one result per command', async () => {
    const { store } = await loadStore();
    const dispatcher = vi.fn(() => ({ success: true, results: [] }));
    store.setCommandBatchDispatcher(dispatcher);

    const result = store.getCommandBatchDispatcher()?.([
      { command: 'update_transform', payload: nested(10_000) },
      { command: 'play' },
    ]);

    expect(dispatcher).not.toHaveBeenCalled();
    expect(result?.success).toBe(false);
    // Callers index into this array by command position, so a short one would
    // read as a success for the commands that fell off the end. Asserted whole:
    // `.every(r => !r.success)` collapses every entry to one boolean and never
    // looks at `error`, so it passes on a result carrying no reason at all.
    expect(result?.results).toEqual([
      { success: false, error: expect.stringContaining('nested too deeply') },
      { success: false, error: expect.stringContaining('nested too deeply') },
    ]);
  });

  it('reports a refused batch once, not once per command', async () => {
    // Reporting per command would print a line per entry for a single event —
    // and, worse, would enter every command in the batch into the
    // session-scoped Sentry dedup set, so a later genuine rejection of any of
    // them would never be reported at all.
    const { store, sentry } = await loadStore();
    store.setCommandBatchDispatcher(() => ({ success: true, results: [] }));

    store.getCommandBatchDispatcher()?.([
      { command: 'update_transform', payload: nested(10_000) },
      { command: 'update_material' },
      { command: 'play' },
    ]);

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);

    // And the commands in it stay eligible for their own report later.
    store.setCommandDispatcher(() => ({ success: false, error: 'nope' }));
    store.getCommandDispatcher()?.('update_transform', {});
    expect(sentry.captureException).toHaveBeenCalledTimes(2);
  });

  it('still dispatches a normal batch', async () => {
    const { store } = await loadStore();
    const dispatcher = vi.fn(() => ({ success: true, results: [] }));
    store.setCommandBatchDispatcher(dispatcher);

    const commands = [{ command: 'play' }];
    store.getCommandBatchDispatcher()?.(commands);

    expect(dispatcher).toHaveBeenCalledWith(commands);
  });
});
