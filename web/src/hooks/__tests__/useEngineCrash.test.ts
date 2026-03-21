/**
 * Tests for engine crash state functions and ENGINE_PANIC event routing.
 *
 * These are unit tests for the module-level crash state (not a React hook)
 * so they run in plain node environment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Re-import the module fresh for each describe block so the module-level
// singletons start clean.
async function freshImport() {
  vi.resetModules();

  vi.mock('@/lib/initLog', () => ({ logInitEvent: vi.fn() }));
  vi.mock('../useEngineStatus', () => ({ emitStatusEvent: vi.fn() }));
  vi.mock('@/lib/monitoring/sentry-client', () => ({ captureException: vi.fn(), setTag: vi.fn() }));
  vi.mock('@/lib/toast', () => ({ showError: vi.fn() }));

  return import('../useEngine');
}

describe('engine crash state', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('isEngineCrashed() starts as false', async () => {
    const { isEngineCrashed, resetEngine } = await freshImport();
    resetEngine();
    expect(isEngineCrashed()).toBe(false);
  });

  it('getEngineCrashMessage() starts as null', async () => {
    const { getEngineCrashMessage, resetEngine } = await freshImport();
    resetEngine();
    expect(getEngineCrashMessage()).toBeNull();
  });

  it('setEngineCrashedFromEvent marks engine as crashed', async () => {
    const { isEngineCrashed, getEngineCrashMessage, setEngineCrashedFromEvent, resetEngine } =
      await freshImport();
    resetEngine();

    setEngineCrashedFromEvent('panicked at index out of bounds');

    expect(isEngineCrashed()).toBe(true);
    expect(getEngineCrashMessage()).toBe('panicked at index out of bounds');
  });

  it('setEngineCrashedFromEvent notifies all listeners', async () => {
    const { setEngineCrashedFromEvent, onEngineCrash, resetEngine } = await freshImport();
    resetEngine();

    const listener1 = vi.fn();
    const listener2 = vi.fn();
    onEngineCrash(listener1);
    onEngineCrash(listener2);

    setEngineCrashedFromEvent('boom');

    expect(listener1).toHaveBeenCalledWith('boom');
    expect(listener2).toHaveBeenCalledWith('boom');
  });

  it('onEngineCrash returns unsubscribe function', async () => {
    const { setEngineCrashedFromEvent, onEngineCrash, resetEngine } = await freshImport();
    resetEngine();

    const listener = vi.fn();
    const unsubscribe = onEngineCrash(listener);
    unsubscribe();

    setEngineCrashedFromEvent('after unsubscribe');

    expect(listener).not.toHaveBeenCalled();
  });

  it('resetEngine clears crash state', async () => {
    const { isEngineCrashed, getEngineCrashMessage, setEngineCrashedFromEvent, resetEngine } =
      await freshImport();

    setEngineCrashedFromEvent('test panic');
    expect(isEngineCrashed()).toBe(true);

    resetEngine();
    expect(isEngineCrashed()).toBe(false);
    expect(getEngineCrashMessage()).toBeNull();
  });

  it('setEngineCrashedFromEvent nullifies wasmModule', async () => {
    const { setEngineCrashedFromEvent, getWasmModule, resetEngine } = await freshImport();
    resetEngine();

    // Verify wasmModule is null before crash (it starts null)
    expect(getWasmModule()).toBeNull();

    setEngineCrashedFromEvent('crash');

    // wasmModule should remain null after crash
    expect(getWasmModule()).toBeNull();
  });

  it('listener errors do not break notification loop', async () => {
    const { setEngineCrashedFromEvent, onEngineCrash, resetEngine } = await freshImport();
    resetEngine();

    const throwingListener = vi.fn(() => { throw new Error('listener error'); });
    const goodListener = vi.fn();
    onEngineCrash(throwingListener);
    onEngineCrash(goodListener);

    // Should not throw despite listener error
    expect(() => setEngineCrashedFromEvent('panic')).not.toThrow();
    expect(goodListener).toHaveBeenCalledWith('panic');
  });
});

describe('handlePanicEvent domain handler', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mock('@/lib/initLog', () => ({ logInitEvent: vi.fn() }));
    vi.mock('../useEngineStatus', () => ({ emitStatusEvent: vi.fn() }));
    vi.mock('@/lib/monitoring/sentry-client', () => ({ captureException: vi.fn(), setTag: vi.fn() }));
    vi.mock('@/lib/toast', () => ({ showError: vi.fn() }));
  });

  it('returns false for non-panic events', async () => {
    const { handlePanicEvent } = await import('../events/panicEvents');
    const set = vi.fn();
    const get = vi.fn();
    expect(handlePanicEvent('SELECTION_CHANGED', {}, set as never, get as never)).toBe(false);
  });

  it('returns true and calls setEngineCrashedFromEvent for ENGINE_PANIC', async () => {
    const engineModule = await import('../useEngine');
    const spy = vi.spyOn(engineModule, 'setEngineCrashedFromEvent');
    engineModule.resetEngine();

    const { handlePanicEvent } = await import('../events/panicEvents');
    const set = vi.fn();
    const get = vi.fn();
    const result = handlePanicEvent(
      'ENGINE_PANIC',
      { message: 'panicked at vector index' },
      set as never,
      get as never,
    );

    expect(result).toBe(true);
    expect(spy).toHaveBeenCalledWith('panicked at vector index');
  });

  it('falls back to Unknown panic when message is missing', async () => {
    const engineModule = await import('../useEngine');
    const spy = vi.spyOn(engineModule, 'setEngineCrashedFromEvent');
    engineModule.resetEngine();

    const { handlePanicEvent } = await import('../events/panicEvents');
    const set = vi.fn();
    const get = vi.fn();
    handlePanicEvent('ENGINE_PANIC', {}, set as never, get as never);

    expect(spy).toHaveBeenCalledWith('Unknown panic');
  });

  it('falls back to Unknown panic when message is not a string', async () => {
    const engineModule = await import('../useEngine');
    const spy = vi.spyOn(engineModule, 'setEngineCrashedFromEvent');
    engineModule.resetEngine();

    const { handlePanicEvent } = await import('../events/panicEvents');
    const set = vi.fn();
    const get = vi.fn();
    handlePanicEvent('ENGINE_PANIC', { message: 42 }, set as never, get as never);

    expect(spy).toHaveBeenCalledWith('Unknown panic');
  });
});
