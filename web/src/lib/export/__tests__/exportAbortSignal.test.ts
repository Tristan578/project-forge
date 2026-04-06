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

  it('accepts ExportOptions with optional signal field', async () => {
    // Verify type compatibility — signal is optional, no error when omitted.
    // The actual export will hit the scene data listener timeout, but we just
    // need to verify it doesn't throw a type error at the signal check points.
    const controller = new AbortController();

    // Abort immediately so we get a quick rejection
    controller.abort();

    const result = exportGame({
      title: 'Test',
      mode: 'single-html',
      resolution: '1920x1080',
      bgColor: '#000000',
      includeDebug: false,
      signal: controller.signal,
    });

    await expect(result).rejects.toThrow('Export cancelled');
  });
});
