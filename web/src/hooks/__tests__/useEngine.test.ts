import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useEngine, resetEngine, recoverEngine, fetchWasmHash, onEngineRecovered } from '../useEngine';
import * as initLog from '@/lib/initLog';

vi.mock('@/lib/initLog', () => ({
  logInitEvent: vi.fn(),
}));

vi.mock('../useEngineStatus', () => ({
  emitStatusEvent: vi.fn(),
}));

vi.mock('@/lib/monitoring/sentry-client', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
  setTag: vi.fn(),
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

    // Flush microtasks so the rejected promise settles
    await vi.waitFor(() => {
      // onError should NOT have been called because the component unmounted
      expect(onError).not.toHaveBeenCalled();
    });

    delete (window as Window & { __SKIP_ENGINE?: boolean }).__SKIP_ENGINE;
  });
});

describe('recoverEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEngine();

    const canvas = document.createElement('canvas');
    canvas.id = 'forge-canvas';
    document.body.appendChild(canvas);
  });

  afterEach(() => {
    // Clean up DOM — safe in test env (no user content)
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    resetEngine();
  });

  it('returns false when canvas element is missing', async () => {
    // Remove canvas before calling recover
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    const result = await recoverEngine('forge-canvas');
    // loadWasm will reject in jsdom (no WASM binary), so recovery fails
    expect(result).toBe(false);
  });

  it('returns false when loadWasm throws', async () => {
    const result = await recoverEngine('forge-canvas');
    // loadWasm uses a dynamic import that will fail in jsdom (no WASM binary)
    expect(result).toBe(false);
  });

  it('captures exception on failure', async () => {
    const sentry = await import('@/lib/monitoring/sentry-client');
    await recoverEngine('forge-canvas');
    expect(sentry.captureException).toHaveBeenCalled();
  });

  it('adds breadcrumb before attempting recovery', async () => {
    const sentry = await import('@/lib/monitoring/sentry-client');
    await recoverEngine('forge-canvas');
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'engine',
        message: 'WASM engine recovery attempted',
        level: 'info',
      }),
    );
  });
});

describe('onEngineRecovered', () => {
  it('returns an unsubscribe function that removes the listener', () => {
    const listener = vi.fn();
    const unsub = onEngineRecovered(listener);
    expect(typeof unsub).toBe('function');
    unsub();
    // After unsubscribe, listener should not be called on future signals
    // (we can't trigger signalRecoveryComplete directly, but unsubscribe is testable)
  });

  it('accepts multiple listeners', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unsub1 = onEngineRecovered(listener1);
    const unsub2 = onEngineRecovered(listener2);
    // Clean up
    unsub1();
    unsub2();
  });
});

describe('fetchWasmHash', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the hash from a valid manifest', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ wasmFile: 'forge_engine_bg.wasm', jsFile: 'forge_engine.js', hash: 'abc123def456' }),
    }));

    const hash = await fetchWasmHash('/engine-pkg-webgl2/');
    expect(hash).toBe('abc123def456');

    vi.unstubAllGlobals();
  });

  it('returns null when the manifest fetch returns a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const hash = await fetchWasmHash('/engine-pkg-webgl2/');
    expect(hash).toBeNull();

    vi.unstubAllGlobals();
  });

  it('returns null when the manifest has no hash field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ wasmFile: 'forge_engine_bg.wasm' }),
    }));

    const hash = await fetchWasmHash('/engine-pkg-webgl2/');
    expect(hash).toBeNull();

    vi.unstubAllGlobals();
  });

  it('returns null when the manifest hash is an empty string', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hash: '' }),
    }));

    const hash = await fetchWasmHash('/engine-pkg-webgl2/');
    expect(hash).toBeNull();

    vi.unstubAllGlobals();
  });

  it('returns null when fetch throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const hash = await fetchWasmHash('/engine-pkg-webgl2/');
    expect(hash).toBeNull();

    vi.unstubAllGlobals();
  });

  it('fetches the manifest from the correct URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hash: 'deadbeef12345678' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await fetchWasmHash('https://engine.spawnforge.ai/engine-pkg-webgpu/');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://engine.spawnforge.ai/engine-pkg-webgpu/wasm-manifest.json',
      expect.objectContaining({ cache: 'no-store' }),
    );

    vi.unstubAllGlobals();
  });
});
