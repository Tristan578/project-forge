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
    expect(context).toMatchObject({
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
