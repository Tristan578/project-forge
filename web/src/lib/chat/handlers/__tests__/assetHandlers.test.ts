import { describe, it, expect } from 'vitest';
import { assetHandlers } from '../assetHandlers';
import { invokeHandler } from './handlerTestUtils';

describe('assetHandlers', () => {
  describe('import_gltf', () => {
    it('calls store.importGltf with base64 data and name', async () => {
      const { result, store } = await invokeHandler(assetHandlers, 'import_gltf', {
        dataBase64: 'Z2xURg==',
        name: 'character.glb',
      });

      expect(result.success).toBe(true);
      // No targetEntityId supplied → the optional third arg is forwarded as undefined,
      // so import_gltf spawns a new root entity rather than replacing in place.
      expect(store.importGltf).toHaveBeenCalledWith('Z2xURg==', 'character.glb', undefined);
    });

    it('threads targetEntityId through to store.importGltf for replace-in-place', async () => {
      const { result, store } = await invokeHandler(assetHandlers, 'import_gltf', {
        dataBase64: 'Z2xURg==',
        name: 'character.glb',
        targetEntityId: 'ent_42',
      });

      expect(result.success).toBe(true);
      expect(store.importGltf).toHaveBeenCalledWith('Z2xURg==', 'character.glb', 'ent_42');
    });

    it('rejects empty dataBase64', async () => {
      const { result } = await invokeHandler(assetHandlers, 'import_gltf', {
        dataBase64: '',
        name: 'test.glb',
      });

      expect(result.success).toBe(false);
    });

    it('rejects missing name', async () => {
      const { result } = await invokeHandler(assetHandlers, 'import_gltf', {
        dataBase64: 'Z2xURg==',
      });

      expect(result.success).toBe(false);
    });

    it('relays the engine\'s refusal of a model instead of reporting "Importing"', async () => {
      // What the store returns when the engine refuses a KTX2-textured model
      // before queueing it (#10396).
      const reason = 'image #0 is a KTX2 texture (declared by its mimeType); KTX2 textures are not supported, convert the model\'s textures to PNG or JPEG and import again';
      const { result } = await invokeHandler(
        assetHandlers,
        'import_gltf',
        { dataBase64: 'Z2xURg==', name: 'crafted.glb' },
        { importGltf: () => ({ success: false, error: reason }) },
      );

      expect(result).toEqual({ success: false, error: reason });
    });
  });

  describe('load_texture', () => {
    it('calls store.loadTexture with all fields', async () => {
      const { result, store } = await invokeHandler(assetHandlers, 'load_texture', {
        dataBase64: 'iVBORw0KGgo=',
        name: 'stone.png',
        entityId: 'ent_123',
        slot: 'base_color',
      });

      expect(result.success).toBe(true);
      expect(store.loadTexture).toHaveBeenCalledWith('iVBORw0KGgo=', 'stone.png', 'ent_123', 'base_color');
    });

    it('rejects missing slot', async () => {
      const { result } = await invokeHandler(assetHandlers, 'load_texture', {
        dataBase64: 'data',
        name: 'tex.png',
        entityId: 'ent_1',
      });

      expect(result.success).toBe(false);
    });

    it('rejects missing entityId', async () => {
      const { result } = await invokeHandler(assetHandlers, 'load_texture', {
        dataBase64: 'data',
        name: 'tex.png',
        slot: 'normal',
      });

      expect(result.success).toBe(false);
    });

    it('refuses a KTX2 data URL before touching the store, naming the accepted formats', async () => {
      // The engine would refuse this (#10396); the tool must not report
      // "Loading texture" for it, and the model needs the reason to act on.
      const { result, store } = await invokeHandler(assetHandlers, 'load_texture', {
        dataBase64: 'data:image/ktx2;base64,q0tUWCAyMLsNChoK',
        name: 'lut.ktx2',
        entityId: 'ent_1',
        slot: 'base_color',
      });

      expect(result).toEqual({
        success: false,
        error: "unsupported texture format 'image/ktx2'; accepted formats are image/png, image/jpeg",
      });
      expect(store.loadTexture).not.toHaveBeenCalled();
    });

    it('accepts a PNG data URL and forwards it whole', async () => {
      const { result, store } = await invokeHandler(assetHandlers, 'load_texture', {
        dataBase64: 'data:image/png;base64,iVBORw0KGgo=',
        name: 'stone.png',
        entityId: 'ent_1',
        slot: 'base_color',
      });

      expect(result.success).toBe(true);
      expect(store.loadTexture).toHaveBeenCalledWith('data:image/png;base64,iVBORw0KGgo=', 'stone.png', 'ent_1', 'base_color');
    });

    it('relays a refusal the store (the engine) answered with', async () => {
      const { result } = await invokeHandler(
        assetHandlers,
        'load_texture',
        { dataBase64: 'iVBORw0KGgo=', name: 'huge.png', entityId: 'ent_1', slot: 'base_color' },
        { loadTexture: () => ({ success: false, error: 'payload is 67500001 bytes of base64, over the 50 MB limit' }) },
      );

      expect(result).toEqual({ success: false, error: 'payload is 67500001 bytes of base64, over the 50 MB limit' });
    });
  });

  describe('remove_texture', () => {
    it('calls store.removeTexture', async () => {
      const { result, store } = await invokeHandler(assetHandlers, 'remove_texture', {
        entityId: 'ent_456',
        slot: 'emissive',
      });

      expect(result.success).toBe(true);
      expect(store.removeTexture).toHaveBeenCalledWith('ent_456', 'emissive');
    });

    it('rejects empty slot', async () => {
      const { result } = await invokeHandler(assetHandlers, 'remove_texture', {
        entityId: 'ent_1',
        slot: '',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('place_asset', () => {
    it('calls store.placeAsset', async () => {
      const { result, store } = await invokeHandler(assetHandlers, 'place_asset', {
        assetId: 'asset_sword',
      });

      expect(result.success).toBe(true);
      expect(store.placeAsset).toHaveBeenCalledWith('asset_sword');
    });

    it('rejects empty assetId', async () => {
      const { result } = await invokeHandler(assetHandlers, 'place_asset', {
        assetId: '',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('delete_asset', () => {
    it('calls store.deleteAsset', async () => {
      const { result, store } = await invokeHandler(assetHandlers, 'delete_asset', {
        assetId: 'asset_old',
      });

      expect(result.success).toBe(true);
      expect(store.deleteAsset).toHaveBeenCalledWith('asset_old');
    });

    it('rejects missing assetId', async () => {
      const { result } = await invokeHandler(assetHandlers, 'delete_asset', {});

      expect(result.success).toBe(false);
    });
  });

  describe('list_assets', () => {
    it('returns empty list when no assets', async () => {
      const { result } = await invokeHandler(assetHandlers, 'list_assets', {});
      const data = result.result as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(data.assets).toEqual([]);
      expect(data.count).toBe(0);
    });

    it('returns asset summaries from store', async () => {
      const { result } = await invokeHandler(assetHandlers, 'list_assets', {}, {
        assetRegistry: {
          a1: { id: 'a1', name: 'Sword', kind: 'model', fileSize: 1024 },
          a2: { id: 'a2', name: 'Shield', kind: 'model', fileSize: 2048 },
        },
      });
      const data = result.result as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(data.count).toBe(2);
      const assets = data.assets as Array<{ id: string; name: string }>;
      expect(assets.map(a => a.name).sort()).toEqual(['Shield', 'Sword']);
    });
  });

  describe('import_audio', () => {
    it('calls store.importAudio', async () => {
      const { result, store } = await invokeHandler(assetHandlers, 'import_audio', {
        dataBase64: 'UklGR...',
        name: 'bgm.mp3',
      });

      expect(result.success).toBe(true);
      expect(store.importAudio).toHaveBeenCalledWith('UklGR...', 'bgm.mp3');
    });

    it('rejects empty name', async () => {
      const { result } = await invokeHandler(assetHandlers, 'import_audio', {
        dataBase64: 'data',
        name: '',
      });

      expect(result.success).toBe(false);
    });
  });
});
