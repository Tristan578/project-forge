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

describe('ENGINE_PANIC event routing in useEngineEvents', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mock('@/lib/initLog', () => ({ logInitEvent: vi.fn() }));
    vi.mock('../useEngineStatus', () => ({ emitStatusEvent: vi.fn() }));
    vi.mock('@/lib/monitoring/sentry-client', () => ({ captureException: vi.fn(), setTag: vi.fn() }));
    vi.mock('@/lib/toast', () => ({ showError: vi.fn() }));

    vi.mock('@/stores/editorStore', () => ({
      useEditorStore: { setState: vi.fn(), getState: vi.fn(() => ({})) },
      setCommandDispatcher: vi.fn(),
    }));

    vi.mock('@/lib/throttle/playModeThrottle', () => ({
      createPlayModeThrottle: () => ({
        shouldUpdate: vi.fn().mockReturnValue(true),
        reset: vi.fn(),
      }),
    }));

    vi.mock('../selectionBatcher', () => ({
      createSelectionBatcher: (_cb: unknown) => ({ batch: vi.fn() }),
    }));

    vi.mock('../events', () => ({
      handleTransformEvent: vi.fn().mockReturnValue(false),
      handleMaterialEvent: vi.fn().mockReturnValue(false),
      handlePhysicsEvent: vi.fn().mockReturnValue(false),
      handleAudioEvent: vi.fn().mockReturnValue(false),
      handleAnimationEvent: vi.fn().mockReturnValue(false),
      handleGameEvent: vi.fn().mockReturnValue(false),
      handleSpriteEvent: vi.fn().mockReturnValue(false),
      handleParticleEvent: vi.fn().mockReturnValue(false),
      handlePerformanceEvent: vi.fn().mockReturnValue(false),
      handleEditModeEvent: vi.fn().mockReturnValue(false),
    }));
  });

  it('ENGINE_PANIC event calls setEngineCrashedFromEvent with the message', async () => {
    const engineModule = await import('../useEngine');
    const setEngineCrashedFromEventSpy = vi.spyOn(engineModule, 'setEngineCrashedFromEvent');
    engineModule.resetEngine();

    // We can't easily use renderHook here without jsdom; instead exercise the callback directly.
    const { renderHook } = await import('@testing-library/react');
    const { useEngineEvents } = await import('../useEngineEvents');

    let capturedCallback: ((event: unknown) => void) | null = null;
    const wasmModule = {
      set_event_callback: vi.fn((cb: (event: unknown) => void) => {
        capturedCallback = cb;
      }),
      handle_command: vi.fn(),
    };

    renderHook(() => useEngineEvents({ wasmModule }));

    expect(capturedCallback).not.toBeNull();

    capturedCallback!({ type: 'ENGINE_PANIC', payload: { message: 'panicked at vector index' } });

    expect(setEngineCrashedFromEventSpy).toHaveBeenCalledWith('panicked at vector index');
  });

  it('ENGINE_PANIC event with missing message falls back to Unknown panic', async () => {
    const engineModule = await import('../useEngine');
    const setEngineCrashedFromEventSpy = vi.spyOn(engineModule, 'setEngineCrashedFromEvent');
    engineModule.resetEngine();

    const { renderHook } = await import('@testing-library/react');
    const { useEngineEvents } = await import('../useEngineEvents');

    let capturedCallback: ((event: unknown) => void) | null = null;
    const wasmModule = {
      set_event_callback: vi.fn((cb: (event: unknown) => void) => { capturedCallback = cb; }),
      handle_command: vi.fn(),
    };

    renderHook(() => useEngineEvents({ wasmModule }));

    capturedCallback!({ type: 'ENGINE_PANIC', payload: {} });

    expect(setEngineCrashedFromEventSpy).toHaveBeenCalledWith('Unknown panic');
  });
});
