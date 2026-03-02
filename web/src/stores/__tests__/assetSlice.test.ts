/**
 * Unit tests for the assetSlice — asset registry and import operations.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAssetSlice, setAssetDispatcher, type AssetSlice } from '../slices/assetSlice';
import type { AssetMetadata } from '../slices/types';

function createTestStore() {
  const store = { state: {} as AssetSlice };
  const set = (partial: Partial<AssetSlice> | ((s: AssetSlice) => Partial<AssetSlice>)) => {
    if (typeof partial === 'function') Object.assign(store.state, partial(store.state));
    else Object.assign(store.state, partial);
  };
  const get = () => store.state;
  store.state = createAssetSlice(set as never, get as never, {} as never);
  return { getState: () => store.state };
}

const sampleAsset: AssetMetadata = {
  id: 'asset-1',
  name: 'Robot Model',
  kind: 'gltf_model',
  fileSize: 1024,
  source: { type: 'upload', filename: 'robot.glb' },
};

describe('assetSlice', () => {
  let store: ReturnType<typeof createTestStore>;
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    setAssetDispatcher(mockDispatch as (command: string, payload: unknown) => void);
    store = createTestStore();
  });

  describe('Initial state', () => {
    it('should have empty asset registry', () => {
      expect(store.getState().assetRegistry).toEqual({});
    });
  });

  describe('Import commands', () => {
    it('importGltf dispatches', () => {
      store.getState().importGltf('base64data', 'robot.glb');
      expect(mockDispatch).toHaveBeenCalledWith('import_gltf', { dataBase64: 'base64data', name: 'robot.glb' });
    });

    it('loadTexture dispatches', () => {
      store.getState().loadTexture('texdata', 'wood.png', 'ent-1', 'baseColor');
      expect(mockDispatch).toHaveBeenCalledWith('load_texture', { dataBase64: 'texdata', name: 'wood.png', entityId: 'ent-1', slot: 'baseColor' });
    });

    it('removeTexture dispatches', () => {
      store.getState().removeTexture('ent-1', 'normalMap');
      expect(mockDispatch).toHaveBeenCalledWith('remove_texture', { entityId: 'ent-1', slot: 'normalMap' });
    });

    it('importAudio dispatches', () => {
      store.getState().importAudio('audiodata', 'bgm.ogg');
      expect(mockDispatch).toHaveBeenCalledWith('import_audio', { dataBase64: 'audiodata', name: 'bgm.ogg' });
    });

    it('placeAsset dispatches', () => {
      store.getState().placeAsset('asset-1');
      expect(mockDispatch).toHaveBeenCalledWith('place_asset', { assetId: 'asset-1' });
    });
  });

  describe('Asset registry management', () => {
    it('setAssetRegistry replaces entire registry', () => {
      store.getState().setAssetRegistry({ 'asset-1': sampleAsset });
      expect(store.getState().assetRegistry['asset-1']).toEqual(sampleAsset);
    });

    it('addAssetToRegistry adds single asset', () => {
      store.getState().addAssetToRegistry(sampleAsset);
      expect(store.getState().assetRegistry['asset-1']).toEqual(sampleAsset);
    });

    it('addAssetToRegistry preserves existing assets', () => {
      store.getState().addAssetToRegistry(sampleAsset);
      const secondAsset: AssetMetadata = { ...sampleAsset, id: 'asset-2', name: 'Tree' };
      store.getState().addAssetToRegistry(secondAsset);
      expect(Object.keys(store.getState().assetRegistry)).toHaveLength(2);
    });

    it('removeAssetFromRegistry removes asset', () => {
      store.getState().addAssetToRegistry(sampleAsset);
      store.getState().removeAssetFromRegistry('asset-1');
      expect(store.getState().assetRegistry['asset-1']).toBeUndefined();
    });

    it('deleteAsset removes from registry and dispatches', () => {
      store.getState().addAssetToRegistry(sampleAsset);
      mockDispatch.mockClear();
      store.getState().deleteAsset('asset-1');
      expect(store.getState().assetRegistry['asset-1']).toBeUndefined();
      expect(mockDispatch).toHaveBeenCalledWith('delete_asset', { assetId: 'asset-1' });
    });
  });

  describe('Dispatcher not set', () => {
    it('does not throw when dispatcher is null', () => {
      setAssetDispatcher(null as never);
      store = createTestStore();
      expect(() => store.getState().importGltf('data', 'file.glb')).not.toThrow();
      expect(() => store.getState().placeAsset('id')).not.toThrow();
    });
  });
});
