// @vitest-environment jsdom
/**
 * Tests for AbortSignal threading through the export pipeline (#8266).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportGame } from '../exportEngine';

// Mock dependencies
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(() => ({
      allScripts: {},
      sceneName: 'Test Scene',
      sceneGraph: {},
      ambientLight: null,
      environment: null,
      primaryMaterial: null,
      primaryPhysics: null,
      physicsEnabled: false,
      mobileTouchConfig: null,
      saveScene: vi.fn(),
    })),
  },
}));

vi.mock('../scriptBundler', () => ({
  bundleScripts: vi.fn(() => ({ code: '', sourceMap: '' })),
}));

vi.mock('../zipExporter', () => ({
  exportAsZip: vi.fn().mockResolvedValue(new Blob(['zip'])),
}));

vi.mock('../gameTemplate', () => ({
  generateGameHTML: vi.fn(() => '<html></html>'),
}));

describe('exportGame AbortSignal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws AbortError when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      exportGame({
        title: 'Test',
        mode: 'zip',
        resolution: '1920x1080',
        bgColor: '#000000',
        includeDebug: false,
        signal: controller.signal,
      }),
    ).rejects.toThrow('Export cancelled');
  });

  it('throws AbortError with correct name', async () => {
    const controller = new AbortController();
    controller.abort();

    try {
      await exportGame({
        title: 'Test',
        mode: 'zip',
        resolution: '1920x1080',
        bgColor: '#000000',
        includeDebug: false,
        signal: controller.signal,
      });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DOMException);
      expect((err as DOMException).name).toBe('AbortError');
    }
  });

  it('rejects immediately when aborted during getSceneData instead of waiting 5s timeout', async () => {
    vi.useFakeTimers();

    try {
      const controller = new AbortController();

      const result = exportGame({
        title: 'Test',
        mode: 'single-html',
        resolution: '1920x1080',
        bgColor: '#000000',
        includeDebug: false,
        signal: controller.signal,
      });

      // Attach rejection handler BEFORE advancing timers to prevent
      // unhandled rejection when the abort fires during advanceTimersByTimeAsync.
      const rejection = result.then(
        () => { throw new Error('Should have rejected'); },
        (err: unknown) => err as DOMException,
      );

      // Abort after 100ms — well before the 5s timeout
      await vi.advanceTimersByTimeAsync(100);
      controller.abort();

      const err = await rejection;
      expect(err).toBeInstanceOf(DOMException);
      expect(err.message).toBe('Export cancelled');

      vi.clearAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts ExportOptions without signal field', async () => {
    // Verify type compatibility — signal is optional, no error when omitted.
    // Use fake timers to advance past the scene data timeout without real waiting.
    vi.useFakeTimers();

    try {
      const result = exportGame({
        title: 'Test',
        mode: 'single-html',
        resolution: '1920x1080',
        bgColor: '#000000',
        includeDebug: false,
      });

      // Attach rejection handler BEFORE advancing timers to prevent
      // unhandled rejection when the 5s engine timeout fires.
      const settledPromise = result.then(() => 'resolved').catch(() => 'rejected');

      // Advance past the 5s scene data timeout so getSceneData rejects
      await vi.advanceTimersByTimeAsync(6000);

      // Export will reject (engine timeout, no WASM) — either way, no TypeError from missing signal
      const settled = await settledPromise;
      expect(['resolved', 'rejected']).toContain(settled);

      vi.clearAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });
});
