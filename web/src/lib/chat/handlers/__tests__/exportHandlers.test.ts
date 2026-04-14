vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportHandlers } from '../exportHandlers';
import type { ToolCallContext } from '../types';

const mockExportGame = vi.fn();
const mockDownloadBlob = vi.fn();
vi.mock('@/lib/export/exportEngine', () => ({
  exportGame: (...args: unknown[]) => mockExportGame(...args),
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}));

vi.mock('@/lib/export/presets', () => ({
  getPreset: (name: string) => {
    const presets: Record<string, { name: string; format: string; resolution: string; loadingScreen: { backgroundColor: string }; includeDebug: boolean }> = {
      'web-optimized': { name: 'Web Optimized', format: 'zip', resolution: '1920x1080', loadingScreen: { backgroundColor: '#000' }, includeDebug: false },
      'mobile': { name: 'Mobile', format: 'zip', resolution: '1280x720', loadingScreen: { backgroundColor: '#111' }, includeDebug: false },
    };
    return presets[name];
  },
  EXPORT_PRESETS: {
    'web-optimized': { name: 'Web Optimized' },
    'mobile': { name: 'Mobile' },
  },
}));

const mockSetLoadingScreenConfig = vi.fn();
const mockSetExportPreset = vi.fn();
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: () => ({
      sceneName: 'TestScene',
      exportPreset: null,
      loadingScreenConfig: null,
      setLoadingScreenConfig: mockSetLoadingScreenConfig,
      setExportPreset: mockSetExportPreset,
    }),
  },
}));

function makeCtx(): ToolCallContext {
  return { store: {} as never, dispatchCommand: vi.fn() } as unknown as ToolCallContext;
}

describe('exportHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExportGame.mockResolvedValue(new Blob(['zip content']));
  });

  describe('export_project_zip', () => {
    it('exports with scene name as default title', async () => {
      const result = await exportHandlers.export_project_zip({}, makeCtx());
      expect(result.success).toBe(true);
      expect(result.message).toContain('TestScene');
      expect(mockExportGame).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'TestScene', mode: 'zip' }),
      );
    });

    it('exports with custom title from args', async () => {
      const result = await exportHandlers.export_project_zip(
        { title: 'My Game' },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain('My Game');
      expect(mockDownloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        'My_Game.zip',
      );
    });

    it('exports with preset config when specified', async () => {
      const result = await exportHandlers.export_project_zip(
        { preset: 'web-optimized' },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(mockExportGame).toHaveBeenCalledWith(
        expect.objectContaining({ resolution: '1920x1080' }),
      );
    });

    it('returns error when exportGame throws', async () => {
      mockExportGame.mockRejectedValue(new Error('WASM not loaded'));
      const result = await exportHandlers.export_project_zip({}, makeCtx());
      expect(result.success).toBe(false);
      expect(result.error).toContain('WASM not loaded');
    });

    it('sanitizes filename with special characters', async () => {
      const result = await exportHandlers.export_project_zip(
        { title: 'My Game! @v2' },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(mockDownloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        'My_Game___v2.zip',
      );
    });
  });

  describe('export_project_pwa', () => {
    it('exports as PWA mode', async () => {
      const result = await exportHandlers.export_project_pwa({}, makeCtx());
      expect(result.success).toBe(true);
      expect(result.message).toContain('PWA');
      expect(mockExportGame).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'pwa' }),
      );
    });

    it('downloads with _pwa.zip suffix', async () => {
      const result = await exportHandlers.export_project_pwa(
        { title: 'PlatformGame' },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(mockDownloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        'PlatformGame_pwa.zip',
      );
    });

    it('returns error when exportGame throws', async () => {
      mockExportGame.mockRejectedValue(new Error('memory limit'));
      const result = await exportHandlers.export_project_pwa({}, makeCtx());
      expect(result.success).toBe(false);
      expect(result.error).toContain('memory limit');
    });
  });

  describe('set_loading_screen', () => {
    it('sets loading screen with valid hex colors', async () => {
      const result = await exportHandlers.set_loading_screen(
        { backgroundColor: '#ff0000', progressBarColor: '#00ff00' },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(mockSetLoadingScreenConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          backgroundColor: '#ff0000',
          progressBarColor: '#00ff00',
        }),
      );
    });

    it('uses defaults when optional fields omitted', async () => {
      const result = await exportHandlers.set_loading_screen({}, makeCtx());
      expect(result.success).toBe(true);
      expect(mockSetLoadingScreenConfig).toHaveBeenCalledWith({
        backgroundColor: '#18181b',
        progressBarColor: '#6366f1',
        progressStyle: 'bar',
        title: undefined,
        subtitle: undefined,
        logoDataUrl: undefined,
      });
    });

    it('rejects invalid hex color for backgroundColor', async () => {
      const result = await exportHandlers.set_loading_screen(
        { backgroundColor: 'red' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
    });

    it('rejects invalid hex color for progressBarColor', async () => {
      const result = await exportHandlers.set_loading_screen(
        { progressBarColor: '#xyz' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
    });

    it('accepts all progressStyle values', async () => {
      for (const style of ['bar', 'spinner', 'dots', 'none'] as const) {
        vi.clearAllMocks();
        const result = await exportHandlers.set_loading_screen(
          { progressStyle: style },
          makeCtx(),
        );
        expect(result.success).toBe(true);
      }
    });

    it('includes title and subtitle in config', async () => {
      const result = await exportHandlers.set_loading_screen(
        { title: 'Loading...', subtitle: 'Please wait' },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(mockSetLoadingScreenConfig).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Loading...', subtitle: 'Please wait' }),
      );
    });
  });

  describe('set_export_preset', () => {
    it('sets valid preset successfully', async () => {
      const result = await exportHandlers.set_export_preset(
        { preset: 'web-optimized' },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain('Web Optimized');
      expect(mockSetExportPreset).toHaveBeenCalledWith(
        'web-optimized',
        expect.objectContaining({ name: 'Web Optimized' }),
      );
    });

    it('returns error for unknown preset name', async () => {
      const result = await exportHandlers.set_export_preset(
        { preset: 'nonexistent' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown preset');
      expect(result.error).toContain('nonexistent');
    });

    it('lists available presets in error message', async () => {
      const result = await exportHandlers.set_export_preset(
        { preset: 'bad' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('web-optimized');
      expect(result.error).toContain('mobile');
    });

    it('validates empty preset name', async () => {
      const result = await exportHandlers.set_export_preset(
        { preset: '' },
        makeCtx(),
      );
      expect(result.success).toBe(false);
    });
  });
});
