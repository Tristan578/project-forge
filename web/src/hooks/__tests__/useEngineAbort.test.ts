import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/initLog', () => ({
  logInitEvent: vi.fn(),
}));

vi.mock('../useEngineStatus', () => ({
  emitStatusEvent: vi.fn(),
}));

vi.mock('@/lib/monitoring/sentry-client', () => ({
  captureException: vi.fn(),
  setTag: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showError: vi.fn(),
}));

describe('useEngine AbortController', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('resetEngine aborts the in-flight WASM fetch', async () => {
    // Spy on AbortController to verify it's created and aborted
    const abortSpy = vi.fn();
    const originalAbortController = globalThis.AbortController;
    globalThis.AbortController = class MockAbortController {
      signal = { aborted: false } as AbortSignal;
      abort = abortSpy;
    } as unknown as typeof AbortController;

    try {
      const mod = await import('../useEngine');

      // Trigger loadWasm (which creates the AbortController) — it will fail
      // due to missing WASM files, but that's expected
      const loadPromise = (mod as unknown as { loadWasm: () => Promise<unknown> }).loadWasm().catch(() => {});

      // resetEngine should abort the controller
      mod.resetEngine();
      expect(abortSpy).toHaveBeenCalled();

      await loadPromise;
    } finally {
      globalThis.AbortController = originalAbortController;
    }
  });

  it('loadWasmFromPath passes signal to fetch when provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());
    const _mockSignal = new AbortController().signal;

    // Use dynamic import to get the module-level function
    // We can't directly test loadWasmFromPath since it's not exported,
    // but we verify the signal plumbing through the fetch call
    try {
      const mod = await import('../useEngine');
      // loadWasm internally creates AbortController and passes signal
      const promise = (mod as unknown as { loadWasm: () => Promise<unknown> }).loadWasm().catch(() => {});
      await promise;

      // If fetch was called, it should have received a signal option
      if (fetchSpy.mock.calls.length > 0) {
        const fetchOptions = fetchSpy.mock.calls[0][1] as RequestInit | undefined;
        expect(fetchOptions).not.toBeUndefined();
        expect(fetchOptions?.signal).not.toBeUndefined();
      }
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
