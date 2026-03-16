import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useEngine, resetEngine } from '../useEngine';
import * as initLog from '@/lib/initLog';

vi.mock('@/lib/initLog', () => ({
  logInitEvent: vi.fn(),
}));

vi.mock('../useEngineStatus', () => ({
  emitStatusEvent: vi.fn(),
}));

// We need to mock the dynamic import in loadWasm, which is hard.
// Instead we'll test the hook behavior by creating a mock canvas and controlling SSR state.
describe('useEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEngine();

    // Setup a mock canvas in the document
    const canvas = document.createElement('canvas');
    canvas.id = 'forge-canvas';
    document.body.appendChild(canvas);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    resetEngine();
  });

  it('bails out if canvas element is not found (similar to SSR)', () => {
    const { result } = renderHook(() => useEngine('non-existent-canvas'));
    expect(result.current.isReady).toBe(false);
    expect(initLog.logInitEvent).toHaveBeenCalledWith('error', 'Canvas element not found', 'No element with id="non-existent-canvas"');
  });

  it('emits error if canvas element is not found', () => {
    const { result } = renderHook(() => useEngine('missing-canvas'));

    expect(result.current.isReady).toBe(false);
    expect(initLog.logInitEvent).toHaveBeenCalledWith('error', 'Canvas element not found', 'No element with id="missing-canvas"');
  });

  it('throws error if __SKIP_ENGINE is set (for CI)', async () => {
    (window as Window & { __SKIP_ENGINE?: boolean }).__SKIP_ENGINE = true;

    const onError = vi.fn();
    const { result } = renderHook(() => useEngine('forge-canvas', { onError }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });

    expect(result.current.error?.message).toContain('Engine loading skipped');
    delete (window as Window & { __SKIP_ENGINE?: boolean }).__SKIP_ENGINE;
  });

  it('sendCommand returns undefined when engine not initialized', () => {
    const { result } = renderHook(() => useEngine('forge-canvas'));
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(result.current.sendCommand('cmd', {})).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith('Engine not initialized');

    consoleSpy.mockRestore();
  });

  it('getWasmModule returns null when not initialized', async () => {
    const { getWasmModule } = await import('../useEngine');
    expect(getWasmModule()).toBeNull();
  });

  it('resetEngine clears module and promise', async () => {
    const { resetEngine: reset, getWasmModule: getModule } = await import('../useEngine');
    reset();
    expect(getModule()).toBeNull();
  });

  it('returns wasmModule as null in hook return', () => {
    const { result } = renderHook(() => useEngine('forge-canvas'));
    expect(result.current.wasmModule).toBeNull();
  });

  it('does not re-initialize on re-render', () => {
    const { rerender } = renderHook(() => useEngine('forge-canvas'));
    const firstCallCount = (initLog.logInitEvent as ReturnType<typeof vi.fn>).mock.calls.length;

    rerender();
    // Should not emit additional events on re-render (initializedRef guards)
    const secondCallCount = (initLog.logInitEvent as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(secondCallCount).toBe(firstCallCount);
  });

  it('starts with isReady=false and error=null', () => {
    const { result } = renderHook(() => useEngine('forge-canvas'));
    expect(result.current.isReady).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns a cleanup function from the loading useEffect', () => {
    const { unmount } = renderHook(() => useEngine('forge-canvas'));
    // Unmounting should not throw — the cleanup sets cancelled=true
    // so any in-flight WASM load is ignored on resolve/reject
    expect(() => unmount()).not.toThrow();
  });

  it('does not update state after unmount (cancelled flag)', async () => {
    (window as Window & { __SKIP_ENGINE?: boolean }).__SKIP_ENGINE = true;

    const onError = vi.fn();
    const { unmount } = renderHook(() => useEngine('forge-canvas', { onError }));

    // Unmount immediately before the async load can settle
    unmount();

    // Wait enough time for the rejected promise to settle
    await new Promise((r) => setTimeout(r, 50));

    // onError should NOT have been called because the component unmounted
    expect(onError).not.toHaveBeenCalled();

    delete (window as Window & { __SKIP_ENGINE?: boolean }).__SKIP_ENGINE;
  });
});
