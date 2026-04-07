// @vitest-environment jsdom
/**
 * Tests for exportHandlers, assetHandlers, and handlers2d.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler, createMockStore } from './handlerTestUtils';
import { exportHandlers } from '../exportHandlers';
import { assetHandlers } from '../assetHandlers';
import { handlers2d } from '../handlers2d';
import type { ToolCallContext, ExecutionResult } from '../types';

// ---------------------------------------------------------------------------
// Mock the export engine so tests don't perform real file I/O
// ---------------------------------------------------------------------------
vi.mock('@/lib/export/exportEngine', () => ({
  exportGame: vi.fn().mockResolvedValue(new Blob(['game'], { type: 'application/zip' })),
  downloadBlob: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock editorStore — export handlers call useEditorStore.getState() internally
// We keep a mutable state object so individual tests can override fields.
// ---------------------------------------------------------------------------
const mockEditorState = {
  sceneName: 'TestScene' as string | null,
  loadingScreenConfig: null as unknown,
  setLoadingScreenConfig: vi.fn(),
  exportPreset: null as unknown,
  setExportPreset: vi.fn(),
  clearExportPreset: vi.fn(),
};

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(() => mockEditorState),
  },
}));

// ===========================================================================
// EXPORT HANDLERS
// ===========================================================================

describe('exportHandlers', () => {
  beforeEach(async () => {
    // Reset mutable state and clear call history
    mockEditorState.sceneName = 'TestScene';
    mockEditorState.loadingScreenConfig = null;
    mockEditorState.setLoadingScreenConfig = vi.fn();
    mockEditorState.exportPreset = null;
    mockEditorState.setExportPreset = vi.fn();
    mockEditorState.clearExportPreset = vi.fn();

    const { exportGame, downloadBlob } = await import('@/lib/export/exportEngine');
    (exportGame as ReturnType<typeof vi.fn>).mockResolvedValue(new Blob(['game'], { type: 'application/zip' }));
    (downloadBlob as ReturnType<typeof vi.fn>).mockReset();
  });

  // -------------------------------------------------------------------------
  // export_project_zip
  // -------------------------------------------------------------------------
  describe('export_project_zip', () => {
    it('exports using the scene name when no title is provided', async () => {
      const { exportGame, downloadBlob } = await import('@/lib/export/exportEngine');
      const { result } = await invokeHandler(exportHandlers, 'export_project_zip', {});
      expect(result.success).toBe(true);
      expect(exportGame).toHaveBeenCalledWith(expect.objectContaining({
        title: 'TestScene',
        mode: 'zip',
      }));
      expect(downloadBlob).toHaveBeenCalled();
      expect(result.message).toContain('TestScene');
    });

    it('uses provided title over scene name', async () => {
      const { exportGame } = await import('@/lib/export/exportEngine');
      const { result } = await invokeHandler(exportHandlers, 'export_project_zip', { title: 'MyGame' });
      expect(result.success).toBe(true);
      expect(exportGame).toHaveBeenCalledWith(expect.objectContaining({ title: 'MyGame' }));
      expect(result.message).toContain('MyGame');
    });

    it('falls back to "Game" when no title and no scene name', async () => {
      mockEditorState.sceneName = null;
      const { exportGame } = await import('@/lib/export/exportEngine');
      const { result } = await invokeHandler(exportHandlers, 'export_project_zip', {});
      expect(result.success).toBe(true);
      expect(exportGame).toHaveBeenCalledWith(expect.objectContaining({ title: 'Game' }));
    });

    it('applies preset config when preset name is given', async () => {
      const { exportGame } = await import('@/lib/export/exportEngine');
      const { result } = await invokeHandler(exportHandlers, 'export_project_zip', { preset: 'web-optimized' });
      expect(result.success).toBe(true);
      // web-optimized preset has bgColor '#1a1a1a'
      expect(exportGame).toHaveBeenCalledWith(expect.objectContaining({
        bgColor: '#1a1a1a',
      }));
    });

    it('falls back to stored exportPreset when no preset arg given', async () => {
      mockEditorState.exportPreset = {
        presetKey: 'itch-io',
        config: {
          name: 'itch.io',
          format: 'zip',
          includeSourceMaps: false,
          compressTextures: true,
          resolution: 'responsive',
          includeDebug: false,
          loadingScreen: { backgroundColor: '#fa5c5c', progressBarColor: '#ffffff', progressStyle: 'bar' },
        },
      };
      const { exportGame } = await import('@/lib/export/exportEngine');
      const { result } = await invokeHandler(exportHandlers, 'export_project_zip', {});
      expect(result.success).toBe(true);
      expect(exportGame).toHaveBeenCalledWith(expect.objectContaining({
        bgColor: '#fa5c5c',
      }));
    });

    it('uses customLoadingScreen from store when available', async () => {
      const customConfig = {
        backgroundColor: '#ff0000',
        progressBarColor: '#00ff00',
        progressStyle: 'spinner' as const,
      };
      mockEditorState.loadingScreenConfig = customConfig;
      const { exportGame } = await import('@/lib/export/exportEngine');
      await invokeHandler(exportHandlers, 'export_project_zip', {});
      expect(exportGame).toHaveBeenCalledWith(expect.objectContaining({
        customLoadingScreen: customConfig,
      }));
    });

    it('downloads blob with sanitized filename', async () => {
      const { downloadBlob } = await import('@/lib/export/exportEngine');
      await invokeHandler(exportHandlers, 'export_project_zip', { title: 'My Cool Game!' });
      expect(downloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        'My_Cool_Game_.zip',
      );
    });

    it('returns error on export failure', async () => {
      const { exportGame } = await import('@/lib/export/exportEngine');
      (exportGame as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Disk full'));
      const { result } = await invokeHandler(exportHandlers, 'export_project_zip', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Disk full');
    });

    it('handles non-Error thrown values', async () => {
      const { exportGame } = await import('@/lib/export/exportEngine');
      (exportGame as ReturnType<typeof vi.fn>).mockRejectedValueOnce('string error');
      const { result } = await invokeHandler(exportHandlers, 'export_project_zip', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('string error');
    });
  });

  // -------------------------------------------------------------------------
  // export_project_pwa
  // -------------------------------------------------------------------------
  describe('export_project_pwa', () => {
    it('exports in pwa mode using scene name', async () => {
      const { exportGame, downloadBlob } = await import('@/lib/export/exportEngine');
      const { result } = await invokeHandler(exportHandlers, 'export_project_pwa', {});
      expect(result.success).toBe(true);
      expect(exportGame).toHaveBeenCalledWith(expect.objectContaining({
        title: 'TestScene',
        mode: 'pwa',
      }));
      expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'TestScene_pwa.zip');
      expect(result.message).toContain('PWA');
    });

    it('defaults to pwa-mobile preset when no preset specified', async () => {
      const { exportGame } = await import('@/lib/export/exportEngine');
      await invokeHandler(exportHandlers, 'export_project_pwa', {});
      // pwa-mobile preset bgColor is '#0f172a'
      expect(exportGame).toHaveBeenCalledWith(expect.objectContaining({
        bgColor: '#0f172a',
      }));
    });

    it('uses provided title over scene name', async () => {
      const { exportGame } = await import('@/lib/export/exportEngine');
      const { result } = await invokeHandler(exportHandlers, 'export_project_pwa', { title: 'MobileDungeon' });
      expect(result.success).toBe(true);
      expect(exportGame).toHaveBeenCalledWith(expect.objectContaining({ title: 'MobileDungeon' }));
    });

    it('can override preset with custom preset name', async () => {
      const { exportGame } = await import('@/lib/export/exportEngine');
      await invokeHandler(exportHandlers, 'export_project_pwa', { preset: 'debug' });
      // debug preset has includeDebug: true
      expect(exportGame).toHaveBeenCalledWith(expect.objectContaining({
        includeDebug: true,
      }));
    });

    it('returns error on export failure', async () => {
      const { exportGame } = await import('@/lib/export/exportEngine');
      (exportGame as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('OOM'));
      const { result } = await invokeHandler(exportHandlers, 'export_project_pwa', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('OOM');
    });
  });

  // -------------------------------------------------------------------------
  // set_loading_screen
  // -------------------------------------------------------------------------
  describe('set_loading_screen', () => {
    it('configures loading screen with all fields provided', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_loading_screen', {
        backgroundColor: '#222222',
        progressBarColor: '#ff0000',
        progressStyle: 'spinner',
        title: 'Loading...',
        subtitle: 'Please wait',
        logoDataUrl: 'data:image/png;base64,abc',
      });

      expect(result.success).toBe(true);
      expect(mockEditorState.setLoadingScreenConfig).toHaveBeenCalledWith({
        backgroundColor: '#222222',
        progressBarColor: '#ff0000',
        progressStyle: 'spinner',
        title: 'Loading...',
        subtitle: 'Please wait',
        logoDataUrl: 'data:image/png;base64,abc',
      });
      expect(result.message).toContain('spinner');
      expect(result.message).toContain('#222222');
    });

    it('uses defaults when no args provided', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_loading_screen', {});
      expect(result.success).toBe(true);
      expect(mockEditorState.setLoadingScreenConfig).toHaveBeenCalledWith(expect.objectContaining({
        backgroundColor: '#18181b',
        progressBarColor: '#6366f1',
        progressStyle: 'bar',
      }));
    });

    it('rejects invalid progressStyle values', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_loading_screen', {
        progressStyle: 'wave',
      });
      expect(result.success).toBe(false);
    });

    it('accepts all valid progressStyle values', async () => {
      for (const style of ['bar', 'spinner', 'dots', 'none'] as const) {
        mockEditorState.setLoadingScreenConfig = vi.fn();
        const { result } = await invokeHandler(exportHandlers, 'set_loading_screen', { progressStyle: style });
        expect(result.success).toBe(true);
        expect(mockEditorState.setLoadingScreenConfig).toHaveBeenCalledWith(expect.objectContaining({ progressStyle: style }));
      }
    });

    // -----------------------------------------------------------------------
    // CSS color injection prevention (Fix 3)
    // -----------------------------------------------------------------------
    it('rejects CSS injection payload in backgroundColor', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_loading_screen', {
        backgroundColor: 'red; } body { display: none',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('backgroundColor');
    });

    it('rejects script injection in backgroundColor via </style>', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_loading_screen', {
        backgroundColor: '</style><script>alert(1)</script>',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-hex string in progressBarColor', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_loading_screen', {
        progressBarColor: 'rgb(255, 0, 0)',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('progressBarColor');
    });

    it('accepts valid 3-digit hex in backgroundColor', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_loading_screen', {
        backgroundColor: '#abc',
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid 6-digit hex in backgroundColor', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_loading_screen', {
        backgroundColor: '#18181b',
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid 8-digit hex in progressBarColor', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_loading_screen', {
        progressBarColor: '#6366f180',
      });
      expect(result.success).toBe(true);
    });

    it('rejects plain color name in progressBarColor', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_loading_screen', {
        progressBarColor: 'blue',
      });
      expect(result.success).toBe(false);
    });

    it('rejects hex without leading # in backgroundColor', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_loading_screen', {
        backgroundColor: '18181b',
      });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // set_export_preset
  // -------------------------------------------------------------------------
  describe('set_export_preset', () => {
    it('returns error when preset arg is missing', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_export_preset', {});
      expect(result.success).toBe(false);
    });

    it('returns error when preset arg is empty string', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_export_preset', { preset: '' });
      expect(result.success).toBe(false);
    });

    it('returns error listing available presets when preset is unknown', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_export_preset', { preset: 'nonexistent-preset' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('nonexistent-preset');
      expect(result.error).toContain('Available');
    });

    it('persists a known preset to the store', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_export_preset', { preset: 'web-optimized' });
      expect(result.success).toBe(true);
      expect(result.message).toContain('Web Optimized');
      expect(mockEditorState.setExportPreset).toHaveBeenCalledWith('web-optimized', expect.objectContaining({
        name: 'Web Optimized',
        format: 'zip',
      }));
    });

    it('persists itch-io preset', async () => {
      const { result } = await invokeHandler(exportHandlers, 'set_export_preset', { preset: 'itch-io' });
      expect(result.success).toBe(true);
      expect(result.message).toContain('itch.io');
      expect(mockEditorState.setExportPreset).toHaveBeenCalledWith('itch-io', expect.objectContaining({
        name: 'itch.io',
        format: 'zip',
      }));
    });
  });
});

// ===========================================================================
// ASSET HANDLERS
// ===========================================================================

describe('assetHandlers', () => {
  // -------------------------------------------------------------------------
  // import_gltf
  // -------------------------------------------------------------------------
  describe('import_gltf', () => {
    it('calls store.importGltf with correct args', async () => {
      const { result, store } = await invokeHandler(
        assetHandlers,
        'import_gltf',
        { dataBase64: 'Z2xURg==', name: 'my-model.glb' },
        { importGltf: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.importGltf).toHaveBeenCalledWith('Z2xURg==', 'my-model.glb');
      expect(result.result).toMatchObject({ message: expect.stringContaining('my-model.glb') });
    });

    it('returns error when dataBase64 is missing', async () => {
      const { result } = await invokeHandler(assetHandlers, 'import_gltf', { name: 'model.glb' });
      expect(result.success).toBe(false);
    });

    it('returns error when dataBase64 is empty string', async () => {
      const { result } = await invokeHandler(assetHandlers, 'import_gltf', { dataBase64: '', name: 'model.glb' });
      expect(result.success).toBe(false);
    });

    it('returns error when name is missing', async () => {
      const { result } = await invokeHandler(assetHandlers, 'import_gltf', { dataBase64: 'abc123' });
      expect(result.success).toBe(false);
    });

    it('returns error when name is empty string', async () => {
      const { result } = await invokeHandler(assetHandlers, 'import_gltf', { dataBase64: 'abc123', name: '' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // load_texture
  // -------------------------------------------------------------------------
  describe('load_texture', () => {
    it('calls store.loadTexture with all required args', async () => {
      const { result, store } = await invokeHandler(
        assetHandlers,
        'load_texture',
        { dataBase64: 'abc', name: 'tex.png', entityId: 'ent-1', slot: 'base_color' },
        { loadTexture: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.loadTexture).toHaveBeenCalledWith('abc', 'tex.png', 'ent-1', 'base_color');
      expect(result.result).toMatchObject({ message: expect.stringContaining('tex.png') });
      expect(result.result).toMatchObject({ message: expect.stringContaining('base_color') });
    });

    it('returns error when dataBase64 is missing', async () => {
      const { result } = await invokeHandler(assetHandlers, 'load_texture', {
        name: 'tex.png', entityId: 'ent-1', slot: 'base_color',
      });
      expect(result.success).toBe(false);
    });

    it('returns error when name is missing', async () => {
      const { result } = await invokeHandler(assetHandlers, 'load_texture', {
        dataBase64: 'abc', entityId: 'ent-1', slot: 'base_color',
      });
      expect(result.success).toBe(false);
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invokeHandler(assetHandlers, 'load_texture', {
        dataBase64: 'abc', name: 'tex.png', slot: 'base_color',
      });
      expect(result.success).toBe(false);
    });

    it('returns error when slot is missing', async () => {
      const { result } = await invokeHandler(assetHandlers, 'load_texture', {
        dataBase64: 'abc', name: 'tex.png', entityId: 'ent-1',
      });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // remove_texture
  // -------------------------------------------------------------------------
  describe('remove_texture', () => {
    it('calls store.removeTexture with entityId and slot', async () => {
      const { result, store } = await invokeHandler(
        assetHandlers,
        'remove_texture',
        { entityId: 'ent-2', slot: 'normal_map' },
        { removeTexture: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.removeTexture).toHaveBeenCalledWith('ent-2', 'normal_map');
      expect(result.result).toMatchObject({ message: expect.stringContaining('normal_map') });
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invokeHandler(assetHandlers, 'remove_texture', { slot: 'normal_map' });
      expect(result.success).toBe(false);
    });

    it('returns error when slot is missing', async () => {
      const { result } = await invokeHandler(assetHandlers, 'remove_texture', { entityId: 'ent-2' });
      expect(result.success).toBe(false);
    });

    it('returns error when slot is empty string', async () => {
      const { result } = await invokeHandler(assetHandlers, 'remove_texture', { entityId: 'ent-2', slot: '' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // place_asset
  // -------------------------------------------------------------------------
  describe('place_asset', () => {
    it('calls store.placeAsset with assetId', async () => {
      const { result, store } = await invokeHandler(
        assetHandlers,
        'place_asset',
        { assetId: 'asset-abc' },
        { placeAsset: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.placeAsset).toHaveBeenCalledWith('asset-abc');
      expect(result.result).toMatchObject({ message: expect.stringContaining('asset-abc') });
    });

    it('returns error when assetId is missing', async () => {
      const { result } = await invokeHandler(assetHandlers, 'place_asset', {});
      expect(result.success).toBe(false);
    });

    it('returns error when assetId is empty string', async () => {
      const { result } = await invokeHandler(assetHandlers, 'place_asset', { assetId: '' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // delete_asset
  // -------------------------------------------------------------------------
  describe('delete_asset', () => {
    it('calls store.deleteAsset with assetId', async () => {
      const { result, store } = await invokeHandler(
        assetHandlers,
        'delete_asset',
        { assetId: 'asset-xyz' },
        { deleteAsset: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.deleteAsset).toHaveBeenCalledWith('asset-xyz');
      expect(result.result).toMatchObject({ message: expect.stringContaining('asset-xyz') });
    });

    it('returns error when assetId is missing', async () => {
      const { result } = await invokeHandler(assetHandlers, 'delete_asset', {});
      expect(result.success).toBe(false);
    });

    it('returns error when assetId is empty string', async () => {
      const { result } = await invokeHandler(assetHandlers, 'delete_asset', { assetId: '' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // list_assets
  // -------------------------------------------------------------------------
  describe('list_assets', () => {
    it('returns empty list when asset registry is empty', async () => {
      const { result } = await invokeHandler(assetHandlers, 'list_assets', {});
      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({ assets: [], count: 0 });
    });

    it('returns assets from registry with id, name, kind, fileSize fields', async () => {
      const { result } = await invokeHandler(
        assetHandlers,
        'list_assets',
        {},
        {
          assetRegistry: {
            'a1': { id: 'a1', name: 'hero.glb', kind: 'gltf', fileSize: 1024 },
            'a2': { id: 'a2', name: 'stone.png', kind: 'texture', fileSize: 512 },
          },
        },
      );
      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({ count: 2 });
      const assets = (result.result as { assets: unknown[] }).assets;
      expect(assets).toContainEqual({ id: 'a1', name: 'hero.glb', kind: 'gltf', fileSize: 1024 });
      expect(assets).toContainEqual({ id: 'a2', name: 'stone.png', kind: 'texture', fileSize: 512 });
    });

    it('does not include extra fields from asset registry entries', async () => {
      const { result } = await invokeHandler(
        assetHandlers,
        'list_assets',
        {},
        {
          assetRegistry: {
            'a1': { id: 'a1', name: 'hero.glb', kind: 'gltf', fileSize: 100, internalData: 'secret' },
          },
        },
      );
      const assets = (result.result as { assets: Record<string, unknown>[] }).assets;
      expect(assets[0]).not.toHaveProperty('internalData');
    });
  });

  // -------------------------------------------------------------------------
  // import_audio
  // -------------------------------------------------------------------------
  describe('import_audio', () => {
    it('calls store.importAudio with dataBase64 and name', async () => {
      const { result, store } = await invokeHandler(
        assetHandlers,
        'import_audio',
        { dataBase64: 'UklGR', name: 'explosion.wav' },
        { importAudio: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.importAudio).toHaveBeenCalledWith('UklGR', 'explosion.wav');
      expect(result.result).toMatchObject({ message: expect.stringContaining('explosion.wav') });
    });

    it('returns error when dataBase64 is missing', async () => {
      const { result } = await invokeHandler(assetHandlers, 'import_audio', { name: 'sound.mp3' });
      expect(result.success).toBe(false);
    });

    it('returns error when name is empty string', async () => {
      const { result } = await invokeHandler(assetHandlers, 'import_audio', { dataBase64: 'abc', name: '' });
      expect(result.success).toBe(false);
    });
  });
});

// ===========================================================================
// HANDLERS 2D — helper types
// ===========================================================================

/**
 * Build a store with all 2D-specific methods mocked in addition to the
 * standard mock store.  Pass any extra overrides as needed per test.
 */
function create2dStore(overrides: Record<string, unknown> = {}): ToolCallContext['store'] {
  return createMockStore({
    setSpriteData: vi.fn(),
    setSpriteSheet: vi.fn(),
    setSpriteAnimator: vi.fn(),
    setAnimationStateMachine: vi.fn(),
    setTilemapData: vi.fn(),
    setTileset: vi.fn(),
    setPhysics2d: vi.fn(),
    removePhysics2d: vi.fn(),
    togglePhysics2d: vi.fn(),
    setSkeleton2d: vi.fn(),
    setSkeletalAnimations2d: vi.fn(),
    setProjectType: vi.fn(),
    setCamera2dData: vi.fn(),
    setSortingLayers: vi.fn(),
    setGrid2d: vi.fn(),
    setGravity2d: vi.fn(),
    setDebugPhysics2d: vi.fn(),
    camera2dData: null,
    spriteSheets: {},
    spriteAnimators: {},
    animationStateMachines: {},
    skeletalAnimations2d: {},
    ...overrides,
  });
}

async function invoke2d(
  name: string,
  args: Record<string, unknown> = {},
  storeOverrides: Record<string, unknown> = {},
): Promise<{ result: ExecutionResult; store: ToolCallContext['store'] }> {
  const store = create2dStore(storeOverrides);
  const result = await handlers2d[name](args, { store, dispatchCommand: vi.fn() });
  return { result, store };
}

// ===========================================================================
// HANDLERS 2D — Sprite Commands
// ===========================================================================

describe('handlers2d sprite commands', () => {
  // -------------------------------------------------------------------------
  // create_sprite
  // -------------------------------------------------------------------------
  describe('create_sprite', () => {
    it('spawns a plane entity and sets default sprite data', async () => {
      const { result, store } = await invoke2d('create_sprite', {}, {
        primaryId: 'new-ent-1',
        spawnEntity: vi.fn(),
        setSpriteData: vi.fn(),
        updateTransform: vi.fn(),
      });
      expect(result.success).toBe(true);
      expect(store.spawnEntity).toHaveBeenCalledWith('plane', undefined);
      expect(store.setSpriteData).toHaveBeenCalledWith('new-ent-1', expect.objectContaining({
        sortingLayer: 'Default',
        sortingOrder: 0,
      }));
      expect(result.result).toMatchObject({ entityId: 'new-ent-1' });
    });

    it('uses provided entityType, name, sortingLayer, sortingOrder', async () => {
      const { result, store } = await invoke2d(
        'create_sprite',
        { entityType: 'cube', name: 'Hero', sortingLayer: 'Foreground', sortingOrder: 5 },
        { primaryId: 'ent-hero', spawnEntity: vi.fn(), setSpriteData: vi.fn(), updateTransform: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.spawnEntity).toHaveBeenCalledWith('cube', 'Hero');
      expect(store.setSpriteData).toHaveBeenCalledWith('ent-hero', expect.objectContaining({
        sortingLayer: 'Foreground',
        sortingOrder: 5,
      }));
    });

    it('updates transform when position is provided', async () => {
      const { store } = await invoke2d(
        'create_sprite',
        { position: [1, 2, 3] },
        { primaryId: 'ent-pos', spawnEntity: vi.fn(), setSpriteData: vi.fn(), updateTransform: vi.fn() },
      );
      expect(store.updateTransform).toHaveBeenCalledWith('ent-pos', 'position', { x: 1, y: 2, z: 3 });
    });

    it('returns error when entity spawn returns null primaryId', async () => {
      const { result } = await invoke2d('create_sprite', {}, {
        primaryId: null,
        spawnEntity: vi.fn(),
        setSpriteData: vi.fn(),
        updateTransform: vi.fn(),
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('entity ID');
    });

    it('rejects invalid entityType', async () => {
      const { result } = await invoke2d('create_sprite', { entityType: 'terrain' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // set_sprite_texture
  // -------------------------------------------------------------------------
  describe('set_sprite_texture', () => {
    it('sets texture on entity using existing sprite data', async () => {
      const existingSprite = { textureAssetId: null, colorTint: [1, 1, 1, 1] as [number, number, number, number], flipX: false, flipY: false, customSize: null, sortingLayer: 'Default', sortingOrder: 0, anchor: 'center' as const };
      const { result, store } = await invoke2d(
        'set_sprite_texture',
        { entityId: 'ent-1', textureAssetId: 'tex-abc' },
        { sprites: { 'ent-1': existingSprite }, setSpriteData: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.setSpriteData).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        textureAssetId: 'tex-abc',
      }));
    });

    it('uses default sprite data when no existing sprite', async () => {
      const { result, store } = await invoke2d(
        'set_sprite_texture',
        { entityId: 'ent-2', textureAssetId: 'tex-xyz' },
        { sprites: {}, setSpriteData: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.setSpriteData).toHaveBeenCalledWith('ent-2', expect.objectContaining({
        textureAssetId: 'tex-xyz',
        sortingLayer: 'Default',
      }));
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('set_sprite_texture', { textureAssetId: 'tex-abc' });
      expect(result.success).toBe(false);
    });

    it('returns error when textureAssetId is missing', async () => {
      const { result } = await invoke2d('set_sprite_texture', { entityId: 'ent-1' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // set_sprite_tint
  // -------------------------------------------------------------------------
  describe('set_sprite_tint', () => {
    it('converts hex color to RGBA tuple and sets sprite data', async () => {
      const { result, store } = await invoke2d(
        'set_sprite_tint',
        { entityId: 'ent-1', color: '#ff0000' },
        { sprites: {}, setSpriteData: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.setSpriteData).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        colorTint: [1, 0, 0, 1],
      }));
    });

    it('handles shorthand 3-digit hex color', async () => {
      const { store } = await invoke2d(
        'set_sprite_tint',
        { entityId: 'ent-1', color: '#f00' },
        { sprites: {}, setSpriteData: vi.fn() },
      );
      expect(store.setSpriteData).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        colorTint: [1, 0, 0, 1],
      }));
    });

    it('handles 8-digit hex with alpha', async () => {
      const { store } = await invoke2d(
        'set_sprite_tint',
        { entityId: 'ent-1', color: '#ffffff80' },
        { sprites: {}, setSpriteData: vi.fn() },
      );
      const call = (store.setSpriteData as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(call.colorTint[3]).toBeCloseTo(0.502, 1);
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('set_sprite_tint', { color: '#ff0000' });
      expect(result.success).toBe(false);
    });

    it('returns error when color is missing', async () => {
      const { result } = await invoke2d('set_sprite_tint', { entityId: 'ent-1' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // set_sprite_flip
  // -------------------------------------------------------------------------
  describe('set_sprite_flip', () => {
    it('sets flipX without changing flipY', async () => {
      const existing = { textureAssetId: null, colorTint: [1, 1, 1, 1] as [number, number, number, number], flipX: false, flipY: true, customSize: null, sortingLayer: 'Default', sortingOrder: 0, anchor: 'center' as const };
      const { store } = await invoke2d(
        'set_sprite_flip',
        { entityId: 'ent-1', flipX: true },
        { sprites: { 'ent-1': existing }, setSpriteData: vi.fn() },
      );
      expect(store.setSpriteData).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        flipX: true,
        flipY: true,
      }));
    });

    it('sets flipY without changing flipX', async () => {
      const existing = { textureAssetId: null, colorTint: [1, 1, 1, 1] as [number, number, number, number], flipX: true, flipY: false, customSize: null, sortingLayer: 'Default', sortingOrder: 0, anchor: 'center' as const };
      const { store } = await invoke2d(
        'set_sprite_flip',
        { entityId: 'ent-1', flipY: true },
        { sprites: { 'ent-1': existing }, setSpriteData: vi.fn() },
      );
      expect(store.setSpriteData).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        flipX: true,
        flipY: true,
      }));
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('set_sprite_flip', { flipX: true });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // set_sprite_sorting
  // -------------------------------------------------------------------------
  describe('set_sprite_sorting', () => {
    it('updates sorting layer and order', async () => {
      const { result, store } = await invoke2d(
        'set_sprite_sorting',
        { entityId: 'ent-1', sortingLayer: 'UI', sortingOrder: 10 },
        { sprites: {}, setSpriteData: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.setSpriteData).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        sortingLayer: 'UI',
        sortingOrder: 10,
      }));
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('set_sprite_sorting', { sortingLayer: 'UI' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // set_sprite_anchor
  // -------------------------------------------------------------------------
  describe('set_sprite_anchor', () => {
    it('sets anchor to bottom_left', async () => {
      const { result, store } = await invoke2d(
        'set_sprite_anchor',
        { entityId: 'ent-1', anchor: 'bottom_left' },
        { sprites: {}, setSpriteData: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.setSpriteData).toHaveBeenCalledWith('ent-1', expect.objectContaining({ anchor: 'bottom_left' }));
    });

    it('rejects invalid anchor value', async () => {
      const { result } = await invoke2d('set_sprite_anchor', { entityId: 'ent-1', anchor: 'top_middle' });
      expect(result.success).toBe(false);
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('set_sprite_anchor', { anchor: 'center' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // get_sprite
  // -------------------------------------------------------------------------
  describe('get_sprite', () => {
    it('returns sprite data for an entity', async () => {
      const spriteData = { textureAssetId: 'tex-1', colorTint: [1, 1, 1, 1] as [number, number, number, number], flipX: false, flipY: false, customSize: null, sortingLayer: 'Default', sortingOrder: 0, anchor: 'center' as const };
      const { result } = await invoke2d(
        'get_sprite',
        { entityId: 'ent-1' },
        { sprites: { 'ent-1': spriteData } },
      );
      expect(result.success).toBe(true);
      expect(result.result).toEqual(spriteData);
    });

    it('returns error when no sprite data for entity', async () => {
      const { result } = await invoke2d('get_sprite', { entityId: 'ent-missing' }, { sprites: {} });
      expect(result.success).toBe(false);
      expect(result.error).toContain('ent-missing');
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('get_sprite', {});
      expect(result.success).toBe(false);
    });
  });
});

// ===========================================================================
// HANDLERS 2D — Project / Camera Commands
// ===========================================================================

describe('handlers2d project and camera commands', () => {
  // -------------------------------------------------------------------------
  // set_project_type
  // -------------------------------------------------------------------------
  describe('set_project_type', () => {
    it('sets project type to 2d', async () => {
      const { result, store } = await invoke2d('set_project_type', { type: '2d' });
      expect(result.success).toBe(true);
      expect(store.setProjectType).toHaveBeenCalledWith('2d');
    });

    it('sets project type to 3d', async () => {
      const { result, store } = await invoke2d('set_project_type', { type: '3d' });
      expect(result.success).toBe(true);
      expect(store.setProjectType).toHaveBeenCalledWith('3d');
    });

    it('returns error when type is missing', async () => {
      const { result } = await invoke2d('set_project_type', {});
      expect(result.success).toBe(false);
    });

    it('rejects invalid type value', async () => {
      const { result } = await invoke2d('set_project_type', { type: 'iso' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // set_camera_2d
  // -------------------------------------------------------------------------
  describe('set_camera_2d', () => {
    it('updates camera zoom when provided', async () => {
      const { result, store } = await invoke2d('set_camera_2d', { zoom: 2 });
      expect(result.success).toBe(true);
      expect(store.setCamera2dData).toHaveBeenCalledWith(expect.objectContaining({ zoom: 2 }));
    });

    it('uses existing camera2dData when available', async () => {
      const { store } = await invoke2d(
        'set_camera_2d',
        { pixelPerfect: true },
        { camera2dData: { zoom: 3, pixelPerfect: false, bounds: null } },
      );
      expect(store.setCamera2dData).toHaveBeenCalledWith({ zoom: 3, pixelPerfect: true, bounds: null });
    });

    it('sets bounds when provided', async () => {
      const bounds = { minX: -10, maxX: 10, minY: -5, maxY: 5 };
      const { store } = await invoke2d('set_camera_2d', { bounds });
      expect(store.setCamera2dData).toHaveBeenCalledWith(expect.objectContaining({ bounds }));
    });

    it('allows null bounds to clear them', async () => {
      const { store } = await invoke2d(
        'set_camera_2d',
        { bounds: null },
        { camera2dData: { zoom: 1, pixelPerfect: false, bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 } } },
      );
      expect(store.setCamera2dData).toHaveBeenCalledWith(expect.objectContaining({ bounds: null }));
    });

    it('succeeds with no args (all optional)', async () => {
      const { result } = await invoke2d('set_camera_2d', {});
      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // set_sorting_layers
  // -------------------------------------------------------------------------
  describe('set_sorting_layers', () => {
    it('calls store.setSortingLayers with provided layers', async () => {
      const layers = [
        { name: 'Background', order: 0, visible: true },
        { name: 'Foreground', order: 1, visible: true },
      ];
      const { result, store } = await invoke2d('set_sorting_layers', { layers });
      expect(result.success).toBe(true);
      expect(store.setSortingLayers).toHaveBeenCalledWith(layers);
      expect(result.result).toMatchObject({ message: expect.stringContaining('2') });
    });

    it('returns error when layers is missing', async () => {
      const { result } = await invoke2d('set_sorting_layers', {});
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // set_grid_2d
  // -------------------------------------------------------------------------
  describe('set_grid_2d', () => {
    it('passes grid settings to store', async () => {
      const { result, store } = await invoke2d('set_grid_2d', { enabled: true, size: 32, snapToGrid: true });
      expect(result.success).toBe(true);
      expect(store.setGrid2d).toHaveBeenCalledWith({ enabled: true, size: 32, snapToGrid: true });
    });

    it('succeeds with no args (all optional)', async () => {
      const { result } = await invoke2d('set_grid_2d', {});
      expect(result.success).toBe(true);
    });
  });
});

// ===========================================================================
// HANDLERS 2D — Sprite Animation Commands
// ===========================================================================

describe('handlers2d sprite animation commands', () => {
  // -------------------------------------------------------------------------
  // slice_sprite_sheet
  // -------------------------------------------------------------------------
  describe('slice_sprite_sheet', () => {
    it('slices with grid mode and computes frames', async () => {
      const { result, store } = await invoke2d(
        'slice_sprite_sheet',
        {
          entityId: 'ent-1',
          assetId: 'sheet-1',
          sliceMode: { type: 'grid', columns: 4, rows: 2, tileSize: [16, 16] },
        },
        { setSpriteSheet: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.setSpriteSheet).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        assetId: 'sheet-1',
      }));
      expect(result.result).toMatchObject({ frameCount: 8 });
    });

    it('slices with manual mode producing no frames', async () => {
      const { result, store } = await invoke2d(
        'slice_sprite_sheet',
        { entityId: 'ent-1', assetId: 'sheet-1', sliceMode: { type: 'manual' } },
        { setSpriteSheet: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({ frameCount: 0 });
      expect(store.setSpriteSheet).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        sliceMode: { type: 'manual', regions: [] },
      }));
    });

    it('creates clips from provided clip definitions', async () => {
      const { store } = await invoke2d(
        'slice_sprite_sheet',
        {
          entityId: 'ent-1',
          assetId: 'sheet-1',
          sliceMode: { type: 'grid', columns: 4, rows: 1 },
          clips: [{ name: 'walk', frames: [0, 1, 2, 3], fps: 8, looping: true }],
        },
        { setSpriteSheet: vi.fn() },
      );
      const sheetData = (store.setSpriteSheet as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(sheetData.clips).toHaveProperty('walk');
      expect(sheetData.clips.walk.frames).toEqual([0, 1, 2, 3]);
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('slice_sprite_sheet', { assetId: 'sheet-1' });
      expect(result.success).toBe(false);
    });

    it('returns error when assetId is missing', async () => {
      const { result } = await invoke2d('slice_sprite_sheet', { entityId: 'ent-1' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // create_sprite_anim_clip
  // -------------------------------------------------------------------------
  describe('create_sprite_anim_clip', () => {
    const existingSheet = {
      assetId: 'sheet-1',
      sliceMode: { type: 'manual' as const, regions: [] },
      frames: [],
      clips: {},
    };

    it('adds a clip to an existing sprite sheet', async () => {
      const { result, store } = await invoke2d(
        'create_sprite_anim_clip',
        { entityId: 'ent-1', clipName: 'run', frames: [4, 5, 6], fps: 10, looping: true },
        { spriteSheets: { 'ent-1': existingSheet }, setSpriteSheet: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.setSpriteSheet).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        clips: expect.objectContaining({
          run: expect.objectContaining({ frames: [4, 5, 6], looping: true }),
        }),
      }));
    });

    it('returns error when no sprite sheet exists for entity', async () => {
      const { result } = await invoke2d(
        'create_sprite_anim_clip',
        { entityId: 'ent-missing', clipName: 'idle', frames: [0] },
        { spriteSheets: {} },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('ent-missing');
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('create_sprite_anim_clip', { clipName: 'idle', frames: [0] });
      expect(result.success).toBe(false);
    });

    it('defaults fps to 12 and looping to true', async () => {
      const { store } = await invoke2d(
        'create_sprite_anim_clip',
        { entityId: 'ent-1', clipName: 'idle', frames: [0, 1] },
        { spriteSheets: { 'ent-1': existingSheet }, setSpriteSheet: vi.fn() },
      );
      const updatedSheet = (store.setSpriteSheet as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updatedSheet.clips.idle.looping).toBe(true);
      expect(updatedSheet.clips.idle.frameDurations.duration).toBeCloseTo(1 / 12, 5);
    });
  });

  // -------------------------------------------------------------------------
  // set_sprite_animator
  // -------------------------------------------------------------------------
  describe('set_sprite_animator', () => {
    it('sets sprite animator with provided data', async () => {
      const { result, store } = await invoke2d(
        'set_sprite_animator',
        { entityId: 'ent-1', spriteSheetId: 'sheet-1', currentClip: 'idle', playing: true, speed: 1.5 },
        { setSpriteAnimator: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.setSpriteAnimator).toHaveBeenCalledWith('ent-1', {
        spriteSheetId: 'sheet-1',
        currentClip: 'idle',
        frameIndex: 0,
        playing: true,
        speed: 1.5,
      });
    });

    it('defaults playing to false and speed to 1', async () => {
      const { store } = await invoke2d(
        'set_sprite_animator',
        { entityId: 'ent-1', spriteSheetId: 'sheet-1' },
        { setSpriteAnimator: vi.fn() },
      );
      expect(store.setSpriteAnimator).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        playing: false,
        speed: 1,
        currentClip: null,
      }));
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('set_sprite_animator', { spriteSheetId: 'sheet-1' });
      expect(result.success).toBe(false);
    });

    it('returns error when spriteSheetId is missing', async () => {
      const { result } = await invoke2d('set_sprite_animator', { entityId: 'ent-1' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // play_sprite_animation
  // -------------------------------------------------------------------------
  describe('play_sprite_animation', () => {
    it('plays the named clip on an existing animator', async () => {
      const existingAnimator = { spriteSheetId: 'sheet-1', currentClip: 'idle', frameIndex: 0, playing: false, speed: 1 };
      const { result, store } = await invoke2d(
        'play_sprite_animation',
        { entityId: 'ent-1', clipName: 'run' },
        { spriteAnimators: { 'ent-1': existingAnimator }, setSpriteAnimator: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.setSpriteAnimator).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        currentClip: 'run',
        playing: true,
        frameIndex: 0,
      }));
    });

    it('returns error when no animator exists for entity', async () => {
      const { result } = await invoke2d(
        'play_sprite_animation',
        { entityId: 'ent-none', clipName: 'run' },
        { spriteAnimators: {} },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('ent-none');
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('play_sprite_animation', { clipName: 'run' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // set_anim_state_machine
  // -------------------------------------------------------------------------
  describe('set_anim_state_machine', () => {
    it('creates a new animation state machine', async () => {
      const { result, store } = await invoke2d(
        'set_anim_state_machine',
        {
          entityId: 'ent-1',
          states: { idle: 'idle', run: 'run' },
          transitions: [
            { fromState: 'idle', toState: 'run', condition: { type: 'always' }, duration: 0.2 },
          ],
          currentState: 'idle',
          parameters: { speed: { type: 'float', value: 0 } },
        },
        { setAnimationStateMachine: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.setAnimationStateMachine).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        currentState: 'idle',
        states: { idle: 'idle', run: 'run' },
      }));
    });

    it('returns error when required fields are missing', async () => {
      const { result } = await invoke2d('set_anim_state_machine', { entityId: 'ent-1' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // set_anim_param
  // -------------------------------------------------------------------------
  describe('set_anim_param', () => {
    const existingASM = {
      states: { idle: 'idle' },
      transitions: [],
      currentState: 'idle',
      parameters: { running: { type: 'bool' as const, value: false } },
    };

    it('updates an existing bool parameter', async () => {
      const { result, store } = await invoke2d(
        'set_anim_param',
        { entityId: 'ent-1', paramName: 'running', value: true },
        { animationStateMachines: { 'ent-1': existingASM }, setAnimationStateMachine: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.setAnimationStateMachine).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        parameters: expect.objectContaining({ running: { type: 'bool', value: true } }),
      }));
    });

    it('infers bool type for new parameter from boolean value', async () => {
      const { store } = await invoke2d(
        'set_anim_param',
        { entityId: 'ent-1', paramName: 'newBool', value: true },
        { animationStateMachines: { 'ent-1': existingASM }, setAnimationStateMachine: vi.fn() },
      );
      const updated = (store.setAnimationStateMachine as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updated.parameters.newBool).toEqual({ type: 'bool', value: true });
    });

    it('infers float type for new parameter from number value', async () => {
      const { store } = await invoke2d(
        'set_anim_param',
        { entityId: 'ent-1', paramName: 'speed', value: 3.5 },
        { animationStateMachines: { 'ent-1': existingASM }, setAnimationStateMachine: vi.fn() },
      );
      const updated = (store.setAnimationStateMachine as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updated.parameters.speed).toEqual({ type: 'float', value: 3.5 });
    });

    it('returns error when no state machine exists for entity', async () => {
      const { result } = await invoke2d(
        'set_anim_param',
        { entityId: 'ent-none', paramName: 'running', value: true },
        { animationStateMachines: {} },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('ent-none');
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('set_anim_param', { paramName: 'running', value: true });
      expect(result.success).toBe(false);
    });
  });
});

// ===========================================================================
// HANDLERS 2D — Tilemap Commands
// ===========================================================================

describe('handlers2d tilemap commands', () => {
  const baseTilemap = {
    tilesetAssetId: 'tileset-1',
    tileSize: [32, 32] as [number, number],
    mapSize: [5, 4] as [number, number],
    layers: [
      {
        name: 'Layer 0',
        tiles: new Array(20).fill(null),
        visible: true,
        opacity: 1,
        isCollision: false,
      },
      {
        name: 'Layer 1',
        tiles: new Array(20).fill(null),
        visible: true,
        opacity: 1,
        isCollision: false,
      },
    ],
    origin: 'TopLeft' as const,
  };

  // -------------------------------------------------------------------------
  // create_tilemap
  // -------------------------------------------------------------------------
  describe('create_tilemap', () => {
    it('spawns a plane and sets tilemap data with defaults', async () => {
      const { result, store } = await invoke2d(
        'create_tilemap',
        { tilesetAssetId: 'tiles-1' },
        { primaryId: 'ent-tile', spawnEntity: vi.fn(), setTilemapData: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.spawnEntity).toHaveBeenCalledWith('plane', 'Tilemap');
      expect(store.setTilemapData).toHaveBeenCalledWith('ent-tile', expect.objectContaining({
        tilesetAssetId: 'tiles-1',
        tileSize: [32, 32],
        mapSize: [20, 15],
      }));
      expect(result.result).toMatchObject({ entityId: 'ent-tile' });
    });

    it('uses provided name, tileSize, mapSize, and origin', async () => {
      const { store } = await invoke2d(
        'create_tilemap',
        { name: 'World', tilesetAssetId: 'tiles-1', tileSize: [16, 16], mapSize: [30, 20], origin: 'Center' },
        { primaryId: 'ent-tile2', spawnEntity: vi.fn(), setTilemapData: vi.fn() },
      );
      expect(store.spawnEntity).toHaveBeenCalledWith('plane', 'World');
      expect(store.setTilemapData).toHaveBeenCalledWith('ent-tile2', expect.objectContaining({
        tileSize: [16, 16],
        mapSize: [30, 20],
        origin: 'Center',
      }));
    });

    it('returns error when tilesetAssetId is missing', async () => {
      const { result } = await invoke2d('create_tilemap', {});
      expect(result.success).toBe(false);
    });

    it('returns error when spawn returns null primaryId', async () => {
      const { result } = await invoke2d(
        'create_tilemap',
        { tilesetAssetId: 'tiles-1' },
        { primaryId: null, spawnEntity: vi.fn(), setTilemapData: vi.fn() },
      );
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // import_tileset
  // -------------------------------------------------------------------------
  describe('import_tileset', () => {
    it('stores tileset data keyed by assetId', async () => {
      const { result, store } = await invoke2d(
        'import_tileset',
        { assetId: 'ts-1', name: 'Forest', tileSize: [16, 16], gridSize: [10, 8] },
        { setTileset: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.setTileset).toHaveBeenCalledWith('ts-1', expect.objectContaining({
        assetId: 'ts-1',
        name: 'Forest',
        tileSize: [16, 16],
        gridSize: [10, 8],
        spacing: 0,
        margin: 0,
      }));
    });

    it('uses provided spacing and margin', async () => {
      const { store } = await invoke2d(
        'import_tileset',
        { assetId: 'ts-1', tileSize: [16, 16], gridSize: [10, 8], spacing: 2, margin: 1 },
        { setTileset: vi.fn() },
      );
      expect(store.setTileset).toHaveBeenCalledWith('ts-1', expect.objectContaining({
        spacing: 2,
        margin: 1,
      }));
    });

    it('returns error when assetId is missing', async () => {
      const { result } = await invoke2d('import_tileset', { tileSize: [16, 16], gridSize: [8, 8] });
      expect(result.success).toBe(false);
    });

    it('returns error when tileSize is missing', async () => {
      const { result } = await invoke2d('import_tileset', { assetId: 'ts-1', gridSize: [8, 8] });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // set_tile
  // -------------------------------------------------------------------------
  describe('set_tile', () => {
    it('sets a specific tile in a layer', async () => {
      const { result, store } = await invoke2d(
        'set_tile',
        { entityId: 'ent-1', layerIndex: 0, x: 2, y: 1, tileIndex: 5 },
        { tilemaps: { 'ent-1': baseTilemap }, setTilemapData: vi.fn() },
      );
      expect(result.success).toBe(true);
      const updatedTilemap = (store.setTilemapData as ReturnType<typeof vi.fn>).mock.calls[0][1];
      // Row 1, Col 2 in a 5-wide map = index 7
      expect(updatedTilemap.layers[0].tiles[7]).toBe(5);
    });

    it('clears a tile when tileIndex is null', async () => {
      const tilemapWithTile = {
        ...baseTilemap,
        layers: [{
          ...baseTilemap.layers[0],
          tiles: baseTilemap.layers[0].tiles.map((_, i) => i === 7 ? 5 : null),
        }],
      };
      const { store } = await invoke2d(
        'set_tile',
        { entityId: 'ent-1', layerIndex: 0, x: 2, y: 1, tileIndex: null },
        { tilemaps: { 'ent-1': tilemapWithTile }, setTilemapData: vi.fn() },
      );
      const updatedTilemap = (store.setTilemapData as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updatedTilemap.layers[0].tiles[7]).toBeNull();
    });

    it('only modifies the specified layer index', async () => {
      const { store } = await invoke2d(
        'set_tile',
        { entityId: 'ent-1', layerIndex: 1, x: 0, y: 0, tileIndex: 3 },
        { tilemaps: { 'ent-1': baseTilemap }, setTilemapData: vi.fn() },
      );
      const updatedTilemap = (store.setTilemapData as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updatedTilemap.layers[0].tiles[0]).toBeNull();
      expect(updatedTilemap.layers[1].tiles[0]).toBe(3);
    });

    it('returns error when no tilemap for entity', async () => {
      const { result } = await invoke2d(
        'set_tile',
        { entityId: 'ent-none', layerIndex: 0, x: 0, y: 0, tileIndex: 1 },
        { tilemaps: {} },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('ent-none');
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('set_tile', { layerIndex: 0, x: 0, y: 0, tileIndex: 1 });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // fill_tiles
  // -------------------------------------------------------------------------
  describe('fill_tiles', () => {
    it('fills a rectangular region with a tile index', async () => {
      const { result, store } = await invoke2d(
        'fill_tiles',
        { entityId: 'ent-1', layerIndex: 0, fromX: 0, fromY: 0, toX: 1, toY: 1, tileIndex: 7 },
        { tilemaps: { 'ent-1': baseTilemap }, setTilemapData: vi.fn() },
      );
      expect(result.success).toBe(true);
      const updated = (store.setTilemapData as ReturnType<typeof vi.fn>).mock.calls[0][1];
      // (0,0)=0, (1,0)=1, (0,1)=5, (1,1)=6 in a 5-wide map
      expect(updated.layers[0].tiles[0]).toBe(7);
      expect(updated.layers[0].tiles[1]).toBe(7);
      expect(updated.layers[0].tiles[5]).toBe(7);
      expect(updated.layers[0].tiles[6]).toBe(7);
      expect(result.result).toMatchObject({ message: expect.stringContaining('4') });
    });

    it('returns error when no tilemap for entity', async () => {
      const { result } = await invoke2d(
        'fill_tiles',
        { entityId: 'ent-none', layerIndex: 0, fromX: 0, fromY: 0, toX: 2, toY: 2, tileIndex: 1 },
        { tilemaps: {} },
      );
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // clear_tiles
  // -------------------------------------------------------------------------
  describe('clear_tiles', () => {
    it('clears the entire layer when no bounds given', async () => {
      const tilemapWithData = {
        ...baseTilemap,
        layers: [{ ...baseTilemap.layers[0], tiles: new Array(20).fill(3) }],
      };
      const { store } = await invoke2d(
        'clear_tiles',
        { entityId: 'ent-1', layerIndex: 0 },
        { tilemaps: { 'ent-1': tilemapWithData }, setTilemapData: vi.fn() },
      );
      const updated = (store.setTilemapData as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updated.layers[0].tiles.every((t: null) => t === null)).toBe(true);
    });

    it('clears only the specified region', async () => {
      const tilemapWithData = {
        ...baseTilemap,
        layers: [{ ...baseTilemap.layers[0], tiles: new Array(20).fill(5) }],
      };
      const { store } = await invoke2d(
        'clear_tiles',
        { entityId: 'ent-1', layerIndex: 0, fromX: 0, fromY: 0, toX: 0, toY: 0 },
        { tilemaps: { 'ent-1': tilemapWithData }, setTilemapData: vi.fn() },
      );
      const updated = (store.setTilemapData as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updated.layers[0].tiles[0]).toBeNull();
      expect(updated.layers[0].tiles[1]).toBe(5);
    });

    it('returns error when no tilemap for entity', async () => {
      const { result } = await invoke2d(
        'clear_tiles',
        { entityId: 'ent-none', layerIndex: 0 },
        { tilemaps: {} },
      );
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // add_tilemap_layer
  // -------------------------------------------------------------------------
  describe('add_tilemap_layer', () => {
    it('adds a new layer to the tilemap', async () => {
      const { result, store } = await invoke2d(
        'add_tilemap_layer',
        { entityId: 'ent-1', name: 'Collision', visible: false },
        { tilemaps: { 'ent-1': baseTilemap }, setTilemapData: vi.fn() },
      );
      expect(result.success).toBe(true);
      const updated = (store.setTilemapData as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updated.layers).toHaveLength(3);
      expect(updated.layers[2].name).toBe('Collision');
      expect(updated.layers[2].visible).toBe(false);
      expect(result.result).toMatchObject({ layerIndex: 2 });
    });

    it('returns error when no tilemap for entity', async () => {
      const { result } = await invoke2d(
        'add_tilemap_layer',
        { entityId: 'ent-none', name: 'Layer' },
        { tilemaps: {} },
      );
      expect(result.success).toBe(false);
    });

    it('returns error when name is missing', async () => {
      const { result } = await invoke2d(
        'add_tilemap_layer',
        { entityId: 'ent-1' },
        { tilemaps: { 'ent-1': baseTilemap } },
      );
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // remove_tilemap_layer
  // -------------------------------------------------------------------------
  describe('remove_tilemap_layer', () => {
    it('removes a layer by index', async () => {
      const { result, store } = await invoke2d(
        'remove_tilemap_layer',
        { entityId: 'ent-1', layerIndex: 0 },
        { tilemaps: { 'ent-1': baseTilemap }, setTilemapData: vi.fn() },
      );
      expect(result.success).toBe(true);
      const updated = (store.setTilemapData as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updated.layers).toHaveLength(1);
      expect(updated.layers[0].name).toBe('Layer 1');
    });

    it('returns error when tilemap has only one layer', async () => {
      const singleLayer = { ...baseTilemap, layers: [baseTilemap.layers[0]] };
      const { result } = await invoke2d(
        'remove_tilemap_layer',
        { entityId: 'ent-1', layerIndex: 0 },
        { tilemaps: { 'ent-1': singleLayer } },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('last');
    });

    it('returns error when no tilemap for entity', async () => {
      const { result } = await invoke2d(
        'remove_tilemap_layer',
        { entityId: 'ent-none', layerIndex: 0 },
        { tilemaps: {} },
      );
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // set_tilemap_layer
  // -------------------------------------------------------------------------
  describe('set_tilemap_layer', () => {
    it('updates layer name, visibility, and opacity', async () => {
      const { result, store } = await invoke2d(
        'set_tilemap_layer',
        { entityId: 'ent-1', layerIndex: 0, name: 'BG', visible: false, opacity: 0.5 },
        { tilemaps: { 'ent-1': baseTilemap }, setTilemapData: vi.fn() },
      );
      expect(result.success).toBe(true);
      const updated = (store.setTilemapData as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updated.layers[0].name).toBe('BG');
      expect(updated.layers[0].visible).toBe(false);
      expect(updated.layers[0].opacity).toBe(0.5);
    });

    it('returns error when no tilemap for entity', async () => {
      const { result } = await invoke2d(
        'set_tilemap_layer',
        { entityId: 'ent-none', layerIndex: 0 },
        { tilemaps: {} },
      );
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // resize_tilemap
  // -------------------------------------------------------------------------
  describe('resize_tilemap', () => {
    it('resizes the tilemap and preserves existing tiles', async () => {
      const tilemapWithTiles = {
        ...baseTilemap,
        layers: [{
          ...baseTilemap.layers[0],
          tiles: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
        }],
      };
      const { result, store } = await invoke2d(
        'resize_tilemap',
        { entityId: 'ent-1', width: 3, height: 3 },
        { tilemaps: { 'ent-1': tilemapWithTiles }, setTilemapData: vi.fn() },
      );
      expect(result.success).toBe(true);
      const updated = (store.setTilemapData as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updated.mapSize).toEqual([3, 3]);
      expect(updated.layers[0].tiles).toHaveLength(9);
      // First 3 tiles of row 0 preserved
      expect(updated.layers[0].tiles[0]).toBe(1);
      expect(updated.layers[0].tiles[1]).toBe(2);
      expect(updated.layers[0].tiles[2]).toBe(3);
    });

    it('returns error when no tilemap for entity', async () => {
      const { result } = await invoke2d(
        'resize_tilemap',
        { entityId: 'ent-none', width: 10, height: 10 },
        { tilemaps: {} },
      );
      expect(result.success).toBe(false);
    });

    it('returns error when width is zero', async () => {
      const { result } = await invoke2d(
        'resize_tilemap',
        { entityId: 'ent-1', width: 0, height: 10 },
        { tilemaps: { 'ent-1': baseTilemap } },
      );
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // get_tilemap
  // -------------------------------------------------------------------------
  describe('get_tilemap', () => {
    it('returns tilemap data for an entity', async () => {
      const { result } = await invoke2d(
        'get_tilemap',
        { entityId: 'ent-1' },
        { tilemaps: { 'ent-1': baseTilemap } },
      );
      expect(result.success).toBe(true);
      expect(result.result).toEqual(baseTilemap);
    });

    it('returns error when no tilemap for entity', async () => {
      const { result } = await invoke2d('get_tilemap', { entityId: 'ent-none' }, { tilemaps: {} });
      expect(result.success).toBe(false);
      expect(result.error).toContain('ent-none');
    });
  });
});

// ===========================================================================
// HANDLERS 2D — 2D Physics Commands
// ===========================================================================

describe('handlers2d 2D physics commands', () => {
  // -------------------------------------------------------------------------
  // set_physics2d
  // -------------------------------------------------------------------------
  describe('set_physics2d', () => {
    it('sets physics2d data merging over defaults', async () => {
      const { result, store } = await invoke2d(
        'set_physics2d',
        { entityId: 'ent-1', bodyType: 'static', friction: 0.8 },
        { setPhysics2d: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.setPhysics2d).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        bodyType: 'static',
        friction: 0.8,
      }), true);
    });

    it('merges over existing physics2d data', async () => {
      const existing = { bodyType: 'dynamic' as const, colliderShape: 'box' as const, size: [1, 1] as [number, number], radius: 0.5, vertices: [] as [number, number][], mass: 2, friction: 0.5, restitution: 0, gravityScale: 1, isSensor: false, lockRotation: false, continuousDetection: false, oneWayPlatform: false, surfaceVelocity: [0, 0] as [number, number] };
      const { store } = await invoke2d(
        'set_physics2d',
        { entityId: 'ent-1', mass: 5 },
        { physics2d: { 'ent-1': existing }, setPhysics2d: vi.fn() },
      );
      expect(store.setPhysics2d).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        mass: 5,
        bodyType: 'dynamic',
      }), true);
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('set_physics2d', { bodyType: 'static' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid bodyType', async () => {
      const { result } = await invoke2d('set_physics2d', { entityId: 'ent-1', bodyType: 'floating' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // remove_physics2d
  // -------------------------------------------------------------------------
  describe('remove_physics2d', () => {
    it('calls store.removePhysics2d', async () => {
      const { result, store } = await invoke2d(
        'remove_physics2d',
        { entityId: 'ent-1' },
        { removePhysics2d: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.removePhysics2d).toHaveBeenCalledWith('ent-1');
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('remove_physics2d', {});
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // get_physics2d
  // -------------------------------------------------------------------------
  describe('get_physics2d', () => {
    it('returns physics2d data for entity', async () => {
      const physicsData = { bodyType: 'dynamic' as const, colliderShape: 'circle' as const, size: [1, 1] as [number, number], radius: 0.5, vertices: [] as [number, number][], mass: 1, friction: 0.5, restitution: 0, gravityScale: 1, isSensor: false, lockRotation: false, continuousDetection: false, oneWayPlatform: false, surfaceVelocity: [0, 0] as [number, number] };
      const { result } = await invoke2d(
        'get_physics2d',
        { entityId: 'ent-1' },
        { physics2d: { 'ent-1': physicsData } },
      );
      expect(result.success).toBe(true);
      expect(result.result).toEqual(physicsData);
    });

    it('returns error when no physics2d data', async () => {
      const { result } = await invoke2d('get_physics2d', { entityId: 'ent-none' }, { physics2d: {} });
      expect(result.success).toBe(false);
      expect(result.error).toContain('ent-none');
    });
  });

  // -------------------------------------------------------------------------
  // set_gravity2d
  // -------------------------------------------------------------------------
  describe('set_gravity2d', () => {
    it('sets gravity to custom values', async () => {
      const { result, store } = await invoke2d('set_gravity2d', { x: 0, y: -20 });
      expect(result.success).toBe(true);
      expect(store.setGravity2d).toHaveBeenCalledWith(0, -20);
    });

    it('uses default gravity when no args given', async () => {
      const { store } = await invoke2d('set_gravity2d', {});
      expect(store.setGravity2d).toHaveBeenCalledWith(0, -9.81);
    });
  });

  // -------------------------------------------------------------------------
  // set_debug_physics2d
  // -------------------------------------------------------------------------
  describe('set_debug_physics2d', () => {
    it('enables debug physics 2D', async () => {
      const { result, store } = await invoke2d('set_debug_physics2d', { enabled: true });
      expect(result.success).toBe(true);
      expect(store.setDebugPhysics2d).toHaveBeenCalledWith(true);
    });

    it('disables debug physics 2D', async () => {
      const { store } = await invoke2d('set_debug_physics2d', { enabled: false });
      expect(store.setDebugPhysics2d).toHaveBeenCalledWith(false);
    });

    it('returns error when enabled is missing', async () => {
      const { result } = await invoke2d('set_debug_physics2d', {});
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // apply_force2d
  // -------------------------------------------------------------------------
  describe('apply_force2d', () => {
    it('returns success and calls togglePhysics2d', async () => {
      const { result, store } = await invoke2d(
        'apply_force2d',
        { entityId: 'ent-1', force: [10, 0] },
        { togglePhysics2d: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.togglePhysics2d).toHaveBeenCalledWith('ent-1', true);
      expect(result.result).toMatchObject({ message: expect.stringContaining('Play mode') });
    });

    it('accepts optional point argument', async () => {
      const { result } = await invoke2d(
        'apply_force2d',
        { entityId: 'ent-1', force: [0, 5], point: [1, 1] },
        { togglePhysics2d: vi.fn() },
      );
      expect(result.success).toBe(true);
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('apply_force2d', { force: [10, 0] });
      expect(result.success).toBe(false);
    });

    it('returns error when force is missing', async () => {
      const { result } = await invoke2d('apply_force2d', { entityId: 'ent-1' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // apply_impulse2d
  // -------------------------------------------------------------------------
  describe('apply_impulse2d', () => {
    it('returns success and calls togglePhysics2d', async () => {
      const { result, store } = await invoke2d(
        'apply_impulse2d',
        { entityId: 'ent-1', impulse: [0, 20] },
        { togglePhysics2d: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.togglePhysics2d).toHaveBeenCalledWith('ent-1', true);
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('apply_impulse2d', { impulse: [0, 20] });
      expect(result.success).toBe(false);
    });

    it('returns error when impulse is missing', async () => {
      const { result } = await invoke2d('apply_impulse2d', { entityId: 'ent-1' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // raycast2d
  // -------------------------------------------------------------------------
  describe('raycast2d', () => {
    it('always returns a failure with informational message about Play mode', async () => {
      const { result } = await invoke2d('raycast2d', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Play mode');
    });
  });
});

// ===========================================================================
// HANDLERS 2D — Skeleton 2D Commands
// ===========================================================================

describe('handlers2d skeleton 2D commands', () => {
  const baseSkeleton = {
    bones: [
      { name: 'root', parentBone: null, localPosition: [0, 0] as [number, number], localRotation: 0, localScale: [1, 1] as [number, number], length: 1, color: [1, 1, 1, 1] as [number, number, number, number] },
      { name: 'arm', parentBone: 'root', localPosition: [1, 0] as [number, number], localRotation: 0, localScale: [1, 1] as [number, number], length: 0.5, color: [1, 1, 1, 1] as [number, number, number, number] },
    ],
    slots: [],
    skins: {},
    activeSkin: 'default',
    ikConstraints: [],
  };

  // -------------------------------------------------------------------------
  // create_skeleton2d
  // -------------------------------------------------------------------------
  describe('create_skeleton2d', () => {
    it('creates an empty skeleton on entity', async () => {
      const { result, store } = await invoke2d(
        'create_skeleton2d',
        { entityId: 'ent-1' },
        { setSkeleton2d: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.setSkeleton2d).toHaveBeenCalledWith('ent-1', expect.objectContaining({
        bones: [],
        ikConstraints: [],
      }));
    });

    it('adds rootBone when provided', async () => {
      const { store } = await invoke2d(
        'create_skeleton2d',
        {
          entityId: 'ent-1',
          rootBone: {
            name: 'spine',
            parentBone: null,
            localPosition: [0, 0],
            localRotation: 0,
            localScale: [1, 1],
            length: 2,
            color: [1, 1, 1, 1],
          },
        },
        { setSkeleton2d: vi.fn() },
      );
      const skeleton = (store.setSkeleton2d as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(skeleton.bones).toHaveLength(1);
      expect(skeleton.bones[0].name).toBe('spine');
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('create_skeleton2d', {});
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // add_bone2d
  // -------------------------------------------------------------------------
  describe('add_bone2d', () => {
    it('adds a new bone to an existing skeleton', async () => {
      const { result, store } = await invoke2d(
        'add_bone2d',
        { entityId: 'ent-1', boneName: 'hand', parentBone: 'arm', position: [2, 0], rotation: 0.5, length: 0.3 },
        { skeletons2d: { 'ent-1': baseSkeleton }, setSkeleton2d: vi.fn() },
      );
      expect(result.success).toBe(true);
      const updated = (store.setSkeleton2d as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updated.bones).toHaveLength(3);
      const newBone = updated.bones.find((b: { name: string }) => b.name === 'hand');
      expect(newBone).toBeDefined();
      expect(newBone.parentBone).toBe('arm');
    });

    it('uses defaults when optional fields not provided', async () => {
      const { store } = await invoke2d(
        'add_bone2d',
        { entityId: 'ent-1', boneName: 'tip' },
        { skeletons2d: { 'ent-1': baseSkeleton }, setSkeleton2d: vi.fn() },
      );
      const updated = (store.setSkeleton2d as ReturnType<typeof vi.fn>).mock.calls[0][1];
      const tip = updated.bones.find((b: { name: string }) => b.name === 'tip');
      expect(tip.parentBone).toBeNull();
      expect(tip.localPosition).toEqual([0, 0]);
      expect(tip.length).toBe(1);
    });

    it('creates a default skeleton when none exists', async () => {
      const { result } = await invoke2d(
        'add_bone2d',
        { entityId: 'ent-new', boneName: 'root' },
        { skeletons2d: {}, setSkeleton2d: vi.fn() },
      );
      expect(result.success).toBe(true);
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('add_bone2d', { boneName: 'root' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // remove_bone2d
  // -------------------------------------------------------------------------
  describe('remove_bone2d', () => {
    it('removes a bone by name', async () => {
      const { result, store } = await invoke2d(
        'remove_bone2d',
        { entityId: 'ent-1', boneName: 'arm' },
        { skeletons2d: { 'ent-1': baseSkeleton }, setSkeleton2d: vi.fn() },
      );
      expect(result.success).toBe(true);
      const updated = (store.setSkeleton2d as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updated.bones).toHaveLength(1);
      expect(updated.bones.find((b: { name: string }) => b.name === 'arm')).toBeUndefined();
    });

    it('returns error when no skeleton for entity', async () => {
      const { result } = await invoke2d(
        'remove_bone2d',
        { entityId: 'ent-none', boneName: 'arm' },
        { skeletons2d: {} },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('ent-none');
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('remove_bone2d', { boneName: 'arm' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // update_bone2d
  // -------------------------------------------------------------------------
  describe('update_bone2d', () => {
    it('updates bone position, rotation, and length', async () => {
      const { result, store } = await invoke2d(
        'update_bone2d',
        { entityId: 'ent-1', boneName: 'arm', position: [2, 1], rotation: 1.57, length: 0.8 },
        { skeletons2d: { 'ent-1': baseSkeleton }, setSkeleton2d: vi.fn() },
      );
      expect(result.success).toBe(true);
      const updated = (store.setSkeleton2d as ReturnType<typeof vi.fn>).mock.calls[0][1];
      const arm = updated.bones.find((b: { name: string }) => b.name === 'arm');
      expect(arm.localPosition).toEqual([2, 1]);
      expect(arm.localRotation).toBe(1.57);
      expect(arm.length).toBe(0.8);
    });

    it('returns error when no skeleton for entity', async () => {
      const { result } = await invoke2d(
        'update_bone2d',
        { entityId: 'ent-none', boneName: 'arm' },
        { skeletons2d: {} },
      );
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // create_skeletal_animation2d
  // -------------------------------------------------------------------------
  describe('create_skeletal_animation2d', () => {
    it('creates a new skeletal animation', async () => {
      const { result, store } = await invoke2d(
        'create_skeletal_animation2d',
        { entityId: 'ent-1', animName: 'walk', looping: true },
        { skeletalAnimations2d: {}, setSkeletalAnimations2d: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.setSkeletalAnimations2d).toHaveBeenCalledWith('ent-1', expect.arrayContaining([
        expect.objectContaining({ name: 'walk', looping: true }),
      ]));
    });

    it('appends to existing animations', async () => {
      const existing = [{ name: 'idle', duration: 1, looping: true, tracks: {} }];
      const { store } = await invoke2d(
        'create_skeletal_animation2d',
        { entityId: 'ent-1', animName: 'jump' },
        { skeletalAnimations2d: { 'ent-1': existing }, setSkeletalAnimations2d: vi.fn() },
      );
      const updated = (store.setSkeletalAnimations2d as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updated).toHaveLength(2);
    });

    it('defaults looping to true', async () => {
      const { store } = await invoke2d(
        'create_skeletal_animation2d',
        { entityId: 'ent-1', animName: 'fall' },
        { skeletalAnimations2d: {}, setSkeletalAnimations2d: vi.fn() },
      );
      const updated = (store.setSkeletalAnimations2d as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updated[0].looping).toBe(true);
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('create_skeletal_animation2d', { animName: 'walk' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // add_keyframe2d
  // -------------------------------------------------------------------------
  describe('add_keyframe2d', () => {
    const existingAnims = [{ name: 'walk', duration: 1, looping: true, tracks: {} }];

    it('adds a keyframe to an existing animation track', async () => {
      const { result, store } = await invoke2d(
        'add_keyframe2d',
        { entityId: 'ent-1', animName: 'walk', boneName: 'root', frame: 12, position: [0, 1], rotation: 0.5 },
        { skeletalAnimations2d: { 'ent-1': existingAnims }, setSkeletalAnimations2d: vi.fn() },
      );
      expect(result.success).toBe(true);
      const updated = (store.setSkeletalAnimations2d as ReturnType<typeof vi.fn>).mock.calls[0][1];
      const walk = updated.find((a: { name: string }) => a.name === 'walk');
      expect(walk.tracks).toHaveProperty('root');
      expect(walk.tracks.root).toHaveLength(1);
      expect(walk.tracks.root[0].time).toBeCloseTo(12 / 24, 5);
    });

    it('returns error when no skeletal animations for entity', async () => {
      const { result } = await invoke2d(
        'add_keyframe2d',
        { entityId: 'ent-none', animName: 'walk', boneName: 'root', frame: 0 },
        { skeletalAnimations2d: {} },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('ent-none');
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('add_keyframe2d', { animName: 'walk', boneName: 'root', frame: 0 });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // play_skeletal_animation2d
  // -------------------------------------------------------------------------
  describe('play_skeletal_animation2d', () => {
    it('calls store.playAnimation with entityId and animName', async () => {
      const { result, store } = await invoke2d(
        'play_skeletal_animation2d',
        { entityId: 'ent-1', animName: 'run' },
        { playAnimation: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.playAnimation).toHaveBeenCalledWith('ent-1', 'run');
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('play_skeletal_animation2d', { animName: 'run' });
      expect(result.success).toBe(false);
    });

    it('returns error when animName is missing', async () => {
      const { result } = await invoke2d('play_skeletal_animation2d', { entityId: 'ent-1' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // set_skeleton2d_skin
  // -------------------------------------------------------------------------
  describe('set_skeleton2d_skin', () => {
    it('adds a skin and sets it as active', async () => {
      const { result, store } = await invoke2d(
        'set_skeleton2d_skin',
        { entityId: 'ent-1', skinName: 'warrior', attachments: { arm: 'sword' } },
        { skeletons2d: { 'ent-1': baseSkeleton }, setSkeleton2d: vi.fn() },
      );
      expect(result.success).toBe(true);
      const updated = (store.setSkeleton2d as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updated.activeSkin).toBe('warrior');
      expect(updated.skins).toHaveProperty('warrior');
    });

    it('creates default skeleton when none exists', async () => {
      const { result } = await invoke2d(
        'set_skeleton2d_skin',
        { entityId: 'ent-new', skinName: 'default' },
        { skeletons2d: {}, setSkeleton2d: vi.fn() },
      );
      expect(result.success).toBe(true);
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('set_skeleton2d_skin', { skinName: 'warrior' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // create_ik_chain2d
  // -------------------------------------------------------------------------
  describe('create_ik_chain2d', () => {
    it('creates an IK chain from bone hierarchy', async () => {
      const { result, store } = await invoke2d(
        'create_ik_chain2d',
        { entityId: 'ent-1', chainName: 'arm_ik', startBone: 'root', endBone: 'arm' },
        { skeletons2d: { 'ent-1': baseSkeleton }, setSkeleton2d: vi.fn() },
      );
      expect(result.success).toBe(true);
      const updated = (store.setSkeleton2d as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updated.ikConstraints).toHaveLength(1);
      expect(updated.ikConstraints[0].name).toBe('arm_ik');
    });

    it('creates default skeleton when none exists', async () => {
      const { result } = await invoke2d(
        'create_ik_chain2d',
        { entityId: 'ent-new', chainName: 'ik', startBone: 'a', endBone: 'b' },
        { skeletons2d: {}, setSkeleton2d: vi.fn() },
      );
      expect(result.success).toBe(true);
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('create_ik_chain2d', { chainName: 'ik', startBone: 'a', endBone: 'b' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // get_skeleton2d
  // -------------------------------------------------------------------------
  describe('get_skeleton2d', () => {
    it('returns skeleton data for entity', async () => {
      const { result } = await invoke2d(
        'get_skeleton2d',
        { entityId: 'ent-1' },
        { skeletons2d: { 'ent-1': baseSkeleton } },
      );
      expect(result.success).toBe(true);
      expect(result.result).toEqual(baseSkeleton);
    });

    it('returns error when no skeleton for entity', async () => {
      const { result } = await invoke2d('get_skeleton2d', { entityId: 'ent-none' }, { skeletons2d: {} });
      expect(result.success).toBe(false);
      expect(result.error).toContain('ent-none');
    });
  });

  // -------------------------------------------------------------------------
  // import_skeleton_json
  // -------------------------------------------------------------------------
  describe('import_skeleton_json', () => {
    it('parses JSON and sets skeleton data', async () => {
      const skeleton = { bones: [], slots: [], skins: {}, activeSkin: 'default', ikConstraints: [] };
      const { result, store } = await invoke2d(
        'import_skeleton_json',
        { entityId: 'ent-1', json: JSON.stringify(skeleton) },
        { setSkeleton2d: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.setSkeleton2d).toHaveBeenCalledWith('ent-1', skeleton);
    });

    it('returns error when JSON is invalid', async () => {
      const { result } = await invoke2d(
        'import_skeleton_json',
        { entityId: 'ent-1', json: '{invalid json}' },
        { setSkeleton2d: vi.fn() },
      );
      expect(result.success).toBe(false);
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('import_skeleton_json', { json: '{}' });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // auto_weight_skeleton2d
  // -------------------------------------------------------------------------
  describe('auto_weight_skeleton2d', () => {
    it('re-dispatches existing skeleton to trigger auto-weighting', async () => {
      const { result, store } = await invoke2d(
        'auto_weight_skeleton2d',
        { entityId: 'ent-1' },
        { skeletons2d: { 'ent-1': baseSkeleton }, setSkeleton2d: vi.fn() },
      );
      expect(result.success).toBe(true);
      expect(store.setSkeleton2d).toHaveBeenCalledWith('ent-1', baseSkeleton);
    });

    it('returns error when no skeleton for entity', async () => {
      const { result } = await invoke2d(
        'auto_weight_skeleton2d',
        { entityId: 'ent-none' },
        { skeletons2d: {} },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('ent-none');
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invoke2d('auto_weight_skeleton2d', {});
      expect(result.success).toBe(false);
    });
  });
});
