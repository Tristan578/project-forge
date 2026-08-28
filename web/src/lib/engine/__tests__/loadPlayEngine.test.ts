import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The module holds a module-level latch, so every case needs a fresh copy.
 * `vi.resetModules()` + dynamic import is the repo's idiom for that.
 */
async function freshLoader() {
  vi.resetModules();
  const mod = await import('../loadPlayEngine');
  return mod.loadPlayEngine;
}

describe('loadPlayEngine', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('hands concurrent callers the same in-flight load', async () => {
    const loadPlayEngine = await freshLoader();

    const first = loadPlayEngine();
    const second = loadPlayEngine();

    // Identity, not just equivalent results: a second attempt would call
    // wasm-bindgen's `default()` again on the same glue module while the first
    // instantiation is still in flight. This is what makes the caller's retry
    // JOIN the running load instead of racing a rival one against it.
    expect(second).toBe(first);

    // The engine bundle is not resolvable under Vitest — that is the whole
    // reason this module exists as a seam — so both settle as rejections.
    // Swallow them here; the rejection path is asserted below.
    await Promise.allSettled([first, second]);
  });

  it('clears the latch after a failed load so the next call retries', async () => {
    const loadPlayEngine = await freshLoader();

    const first = loadPlayEngine();
    await expect(first).rejects.toBeDefined();

    const second = loadPlayEngine();
    // A failed attempt produced no instance, so it must not be cached as one.
    expect(second).not.toBe(first);

    await expect(second).rejects.toBeDefined();
  });

  it('does not leave the rejection unhandled when nobody retries', async () => {
    const loadPlayEngine = await freshLoader();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    try {
      await expect(loadPlayEngine()).rejects.toBeDefined();
      // The internal `.catch` that clears the latch is a second branch off the
      // same promise; if the caller's branch were the only handled one, or if
      // that internal branch rethrew, this would fire.
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('selectPlayEngineBackend', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('falls back to webgl2 when WebGPU exposes no adapter', async () => {
    const requestAdapter = vi.fn().mockResolvedValue(null);
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    const { selectPlayEngineBackend } = await import('../loadPlayEngine');

    await expect(selectPlayEngineBackend()).resolves.toBe('webgl2');
    expect(requestAdapter).toHaveBeenCalledOnce();
  });

  it('selects webgpu only after obtaining an adapter', async () => {
    const adapter = {};
    const requestAdapter = vi.fn().mockResolvedValue(adapter);
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    const { selectPlayEngineBackend } = await import('../loadPlayEngine');

    await expect(selectPlayEngineBackend()).resolves.toBe('webgpu');
  });

  it('falls back to webgl2 when the adapter request rejects', async () => {
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn().mockRejectedValue(new Error('blocked GPU')) },
    });
    const { selectPlayEngineBackend } = await import('../loadPlayEngine');

    await expect(selectPlayEngineBackend()).resolves.toBe('webgl2');
  });
});
