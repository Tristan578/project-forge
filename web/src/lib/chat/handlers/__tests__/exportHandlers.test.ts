/**
 * Tests for exportHandlers — ZIP/PWA export, loading screen config, presets.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { exportHandlers } from '../exportHandlers';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExportGame = vi.fn();
const mockDownloadBlob = vi.fn();
const mockGetPreset = vi.fn();
const mockPresets: Record<string, unknown> = {
  mobile: {
    name: 'Mobile',
    format: 'zip',
    resolution: '720p',
    includeDebug: false,
    loadingScreen: { backgroundColor: '#000000' },
  },
  desktop: {
    name: 'Desktop',
    format: 'zip',
    resolution: '1080p',
    includeDebug: true,
    loadingScreen: { backgroundColor: '#1a1a2e' },
  },
};

vi.mock('@/lib/export/exportEngine', () => ({
  exportGame: (...args: unknown[]) => mockExportGame(...args),
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}));

vi.mock('@/lib/export/presets', () => ({
  getPreset: (...args: unknown[]) => mockGetPreset(...args),
  EXPORT_PRESETS: new Proxy({}, {
    get(_t, k) { return mockPresets[k as string]; },
    ownKeys() { return Object.keys(mockPresets); },
    getOwnPropertyDescriptor(_t, k) {
      if (k in mockPresets) return { enumerable: true, configurable: true, value: mockPresets[k as string] };
    },
  }),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: () => ({
      sceneName: 'My Game',
      exportPreset: null,
      loadingScreenConfig: null,
      setLoadingScreenConfig: vi.fn(),
      setExportPreset: vi.fn(),
    }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockExportGame.mockResolvedValue(new Blob(['zip-data'], { type: 'application/zip' }));
  mockGetPreset.mockImplementation((name: string) => mockPresets[name] ?? null);
});

describe('exportHandlers', () => {
  // ---------------------------------------------------------------------------
  // export_project_zip
  // ---------------------------------------------------------------------------

  describe('export_project_zip', () => {
    it('exports with default title from store', async () => {
      const { result } = await invokeHandler(exportHandlers, 'export_project_zip', {});

      expect(result.success).toBe(true);
      expect(result.message).toContain('My Game');
      expect(mockExportGame).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'My Game', mode: 'zip' })
      );
      expect(mockDownloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        'My_Game.zip'
      );
    });

    it('exports with custom title', async () => {
      const { result } = await invokeHandler(exportHandlers, 'export_project_zip', {
        title: 'Space Adventure',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Space Adventure');
      expect(mockDownloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        'Space_Adventure.zip'
      );
    });

    it('applies preset config when specified', async () => {
      await invokeHandler(exportHandlers, 'export_project_zip', {
        preset: 'mobile',
      });

      expect(mockGetPreset).toHaveBeenCalledWith('mobile');
      expect(mockExportGame).toHaveBeenCalledWith(
        expect.objectContaining({ resolution: '720p', includeDebug: false })
      );
    });

    it('returns error on export failure', async () => {
      mockExportGame.mockRejectedValue(new Error('WASM not loaded'));

      const { result } = await invokeHandler(exportHandlers, 'export_project_zip', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('WASM not loaded');
    });

    it('handles non-Error throw', async () => {
      mockExportGame.mockRejectedValue('unknown error');

      const { result } = await invokeHandler(exportHandlers, 'export_project_zip', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('unknown error');
    });

    it('sanitizes title for filename', async () => {
      await invokeHandler(exportHandlers, 'export_project_zip', {
        title: 'My Game! (v2)',
      });

      expect(mockDownloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        'My_Game___v2_.zip'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // export_project_pwa
  // ---------------------------------------------------------------------------

  describe('export_project_pwa', () => {
    it('exports as PWA', async () => {
      const { result } = await invokeHandler(exportHandlers, 'export_project_pwa', {});

      expect(result.success).toBe(true);
      expect(result.message).toContain('PWA');
      expect(mockExportGame).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'pwa' })
      );
      expect(mockDownloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        'My_Game_pwa.zip'
      );
    });

    it('returns error on PWA export failure', async () => {
      mockExportGame.mockRejectedValue(new Error('Service worker generation failed'));

      const { result } = await invokeHandler(exportHandlers, 'export_project_pwa', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Service worker generation failed');
    });
  });

  // ---------------------------------------------------------------------------
  // set_loading_screen
  // ---------------------------------------------------------------------------

  describe('set_loading_screen', () => {
    it('sets loading screen with defaults', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_loading_screen', {});

      expect(result.success).toBe(true);
      expect(result.message).toContain('bar');
      expect(result.message).toContain('#18181b');
    });

    it('sets loading screen with custom values', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_loading_screen', {
        backgroundColor: '#ff0000',
        progressBarColor: '#00ff00',
        progressStyle: 'spinner',
        title: 'Loading...',
        subtitle: 'Please wait',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('spinner');
      expect(result.message).toContain('#ff0000');
    });

    it('rejects invalid hex color', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_loading_screen', {
        backgroundColor: 'red',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('rejects invalid progress style', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_loading_screen', {
        progressStyle: 'rainbow',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('accepts valid hex formats (3, 4, 6, 8 digits)', async () => {
      for (const color of ['#fff', '#abcd', '#aabbcc', '#aabbccdd']) {
        const { result } = await invokeHandler(exportHandlers, 'set_loading_screen', {
          backgroundColor: color,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // set_export_preset
  // ---------------------------------------------------------------------------

  describe('set_export_preset', () => {
    it('sets a known preset', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_export_preset', {
        preset: 'mobile',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Mobile');
    });

    it('rejects unknown preset', async () => {
      mockGetPreset.mockReturnValue(null);

      const { result } = await invokeHandler(exportHandlers, 'set_export_preset', {
        preset: 'nonexistent',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown preset');
      expect(result.error).toContain('nonexistent');
    });

    it('rejects empty preset name', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_export_preset', {
        preset: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('rejects missing preset', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_export_preset', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });
  });
});
