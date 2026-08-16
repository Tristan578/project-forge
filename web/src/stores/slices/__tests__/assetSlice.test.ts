import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createAssetSlice, setAssetDispatcher, type AssetSlice } from '../assetSlice';

import type { AssetMetadata } from '../types';

// Only the queue is stubbed. `decodeBase64ToArrayBuffer` stays real, because
// whether the bytes decode is exactly what decides if anything is queued at all.
vi.mock('@/lib/audio/entityAudioGraph', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/audio/entityAudioGraph')>()),
  queueAudioImport: vi.fn(),
}));

import { queueAudioImport } from '@/lib/audio/entityAudioGraph';

const defaultSource: AssetMetadata['source'] = { type: 'upload', filename: 'test.glb' };

let store: ReturnType<typeof createSliceStore<AssetSlice>>;
let mockDispatch: ReturnType<typeof createMockDispatch>;

beforeEach(() => {
  vi.clearAllMocks();
  store = createSliceStore(createAssetSlice);
  mockDispatch = createMockDispatch();
  setAssetDispatcher(mockDispatch);
});

afterEach(() => {
  setAssetDispatcher(null as unknown as (command: string, payload: unknown) => void);
});

describe('assetSlice', () => {
  describe('initial state', () => {
    it('should have empty assetRegistry', () => {
      expect(store.getState().assetRegistry).toEqual({});
    });
  });

  describe('importGltf', () => {
    it('should dispatch only', () => {
      store.getState().importGltf('data:base64...', 'model.glb');

      expect(mockDispatch).toHaveBeenCalledWith('import_gltf', {
        dataBase64: 'data:base64...',
        name: 'model.glb',
      });
    });
  });

  describe('loadTexture', () => {
    it('should dispatch only', () => {
      store.getState().loadTexture('data:base64...', 'texture.png', 'entity1', 'base_color_texture');

      expect(mockDispatch).toHaveBeenCalledWith('load_texture', {
        dataBase64: 'data:base64...',
        name: 'texture.png',
        entityId: 'entity1',
        slot: 'base_color_texture',
      });
    });
  });

  describe('removeTexture', () => {
    it('should dispatch only', () => {
      store.getState().removeTexture('entity1', 'base_color_texture');

      expect(mockDispatch).toHaveBeenCalledWith('remove_texture', {
        entityId: 'entity1',
        slot: 'base_color_texture',
      });
    });
  });

  describe('importAudio', () => {
    // A real one-byte WAV-ish payload: `atob` has to succeed for anything to be
    // queued, and the fixture used elsewhere in this file ('data:base64...')
    // deliberately has no comma, so it decodes to null.
    const REAL_BASE64 = 'data:audio/wav;base64,AAAA';

    it('should dispatch only', () => {
      store.getState().importAudio('data:base64...', 'sound.mp3');

      expect(mockDispatch).toHaveBeenCalledWith('import_audio', {
        dataBase64: 'data:base64...',
        name: 'sound.mp3',
      });
    });

    it('holds the decoded bytes under the import name', () => {
      // The engine drops `dataBase64` and mints its own asset id, so these bytes
      // are the only copy the Web Audio graph will ever see and `name` is the
      // only thing correlating them with the ASSET_IMPORTED that follows.
      store.getState().importAudio(REAL_BASE64, 'jump.wav');

      expect(vi.mocked(queueAudioImport)).toHaveBeenCalledTimes(1);
      const [name, bytes] = vi.mocked(queueAudioImport).mock.calls[0]!;
      expect(name).toBe('jump.wav');
      expect(bytes.byteLength).toBe(3);
    });

    it('still dispatches when the payload cannot be decoded', () => {
      // A clip whose bytes we cannot decode is a silent clip, not a failed
      // import — the engine's copy of the metadata is what the asset panel and
      // the scene are built from.
      store.getState().importAudio('data:base64...', 'sound.mp3');

      expect(vi.mocked(queueAudioImport)).not.toHaveBeenCalled();
      expect(mockDispatch).toHaveBeenCalledWith('import_audio', expect.anything());
    });

    it('queues nothing when there is no dispatcher', () => {
      // The queue is drained by ASSET_IMPORTED, which only ever arrives in
      // answer to this command. Queueing without dispatching leaves an entry
      // nothing can claim, occupying a FIFO slot until real imports evict it.
      setAssetDispatcher(null as unknown as (command: string, payload: unknown) => void);

      store.getState().importAudio(REAL_BASE64, 'jump.wav');

      expect(vi.mocked(queueAudioImport)).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('placeAsset', () => {
    it('should dispatch only', () => {
      store.getState().placeAsset('asset123');

      expect(mockDispatch).toHaveBeenCalledWith('place_asset', {
        assetId: 'asset123',
      });
    });
  });

  describe('deleteAsset', () => {
    it('should remove from state and dispatch when asset exists', () => {
      const asset: AssetMetadata = {
        id: 'asset1',
        name: 'model.glb',
        kind: 'gltf_model',
        fileSize: 1024,
        source: defaultSource,
      };
      store.getState().addAssetToRegistry(asset);

      store.getState().deleteAsset('asset1');

      expect(store.getState().assetRegistry.asset1).toBeUndefined();
      expect(mockDispatch).toHaveBeenCalledWith('delete_asset', {
        assetId: 'asset1',
      });
    });

    it('should dispatch even when asset does not exist', () => {
      store.getState().deleteAsset('nonexistent');

      expect(mockDispatch).toHaveBeenCalledWith('delete_asset', {
        assetId: 'nonexistent',
      });
    });
  });

  describe('setAssetRegistry', () => {
    it('should replace entire registry (state only)', () => {
      const assets: Record<string, AssetMetadata> = {
        asset1: { id: 'asset1', name: 'model1.glb', kind: 'gltf_model', fileSize: 1024, source: defaultSource },
        asset2: { id: 'asset2', name: 'texture1.png', kind: 'texture', fileSize: 512, source: defaultSource },
      };

      store.getState().setAssetRegistry(assets);

      expect(store.getState().assetRegistry).toEqual(assets);
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('addAssetToRegistry', () => {
    it('should add new asset to registry (state only)', () => {
      const asset: AssetMetadata = {
        id: 'asset1',
        name: 'model.glb',
        kind: 'gltf_model',
        fileSize: 2048,
        source: defaultSource,
      };

      store.getState().addAssetToRegistry(asset);

      expect(store.getState().assetRegistry.asset1).toEqual(asset);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should overwrite existing asset in registry (state only)', () => {
      const asset1: AssetMetadata = {
        id: 'asset1',
        name: 'model.glb',
        kind: 'gltf_model',
        fileSize: 1024,
        source: defaultSource,
      };
      const asset2: AssetMetadata = {
        id: 'asset1',
        name: 'updated.glb',
        kind: 'gltf_model',
        fileSize: 2048,
        source: defaultSource,
      };

      store.getState().addAssetToRegistry(asset1);
      store.getState().addAssetToRegistry(asset2);

      expect(store.getState().assetRegistry.asset1).toEqual(asset2);
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('removeAssetFromRegistry', () => {
    it('should remove existing asset from registry without dispatch', () => {
      const asset: AssetMetadata = {
        id: 'asset1',
        name: 'model.glb',
        kind: 'gltf_model',
        fileSize: 1024,
        source: defaultSource,
      };
      store.getState().addAssetToRegistry(asset);

      store.getState().removeAssetFromRegistry('asset1');

      expect(store.getState().assetRegistry.asset1).toBeUndefined();
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should do nothing when removing non-existent asset', () => {
      store.getState().removeAssetFromRegistry('nonexistent');

      expect(store.getState().assetRegistry).toEqual({});
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });
});
