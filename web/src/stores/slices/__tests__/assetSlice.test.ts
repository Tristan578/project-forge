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

// A format refusal is shown to the person from the slice (persistent, with
// the reason); mock the toast module so the message can be asserted without
// sonner's DOM host.
vi.mock('@/lib/toast', () => ({
  showError: vi.fn(),
  showPersistentError: vi.fn(),
  showSuccess: vi.fn(),
  showInfo: vi.fn(),
}));

import { showPersistentError } from '@/lib/toast';

const defaultSource: AssetMetadata['source'] = { type: 'upload', filename: 'test.glb' };

/** A 1x1 PNG as a data URL: the shape every picker now sends. */
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const KTX2_DATA_URL = 'data:image/ktx2;base64,q0tUWCAyMLsNChoK';
const KTX2_REFUSAL = "unsupported texture format 'image/ktx2'; accepted formats are image/png, image/jpeg";

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
      const outcome = store.getState().importGltf('data:base64...', 'model.glb');

      expect(mockDispatch).toHaveBeenCalledWith('import_gltf', {
        dataBase64: 'data:base64...',
        name: 'model.glb',
      });
      // A dispatcher that answers nothing is not reporting failure.
      expect(outcome).toEqual({ success: true });
      expect(showPersistentError).not.toHaveBeenCalled();
    });

    it('shows the engine\'s format refusal with its reason, and returns it', () => {
      // What the engine answers for a model whose image #0 is KTX2 (#10396).
      mockDispatch.mockReturnValue({
        success: false,
        error: 'import_gltf refused: image #0 is a KTX2 texture (declared by its mimeType); KTX2 textures are not supported, convert the model\'s textures to PNG or JPEG and import again',
      });

      const outcome = store.getState().importGltf('Z2xURg==', 'crafted.glb');

      const reason = 'image #0 is a KTX2 texture (declared by its mimeType); KTX2 textures are not supported, convert the model\'s textures to PNG or JPEG and import again';
      expect(outcome).toEqual({ success: false, error: reason });
      expect(showPersistentError).toHaveBeenCalledTimes(1);
      expect(showPersistentError).toHaveBeenCalledWith(
        `Couldn't import the model: ${reason}`,
        { id: 'import_gltf-refused' },
      );
    });

    it('leaves a rejection that is not a format refusal to the generic report', () => {
      // editorStore's tracked dispatcher already reports every rejection once
      // per command; only the `refused:` contract gets the per-file toast.
      mockDispatch.mockReturnValue({ success: false, error: 'PendingCommands resource not initialized' });

      const outcome = store.getState().importGltf('Z2xURg==', 'model.glb');

      expect(outcome).toEqual({ success: false, error: 'PendingCommands resource not initialized' });
      expect(showPersistentError).not.toHaveBeenCalled();
    });

    it('does not read a throw as a refusal', () => {
      mockDispatch.mockReturnValue({ success: false, error: 'import_gltf refused: x', threw: true });

      const outcome = store.getState().importGltf('Z2xURg==', 'model.glb');

      expect(outcome.success).toBe(false);
      expect(showPersistentError).not.toHaveBeenCalled();
    });

    it('cuts an over-long engine reason with a visible marker', () => {
      mockDispatch.mockReturnValue({ success: false, error: `import_gltf refused: ${'r'.repeat(600)}` });

      const outcome = store.getState().importGltf('Z2xURg==', 'model.glb');

      expect(outcome.error).toBe(`${'r'.repeat(512)}… [truncated]`);
      expect(vi.mocked(showPersistentError).mock.calls[0]![0]).toContain('… [truncated]');
    });

    it('forwards an optional stable asset id', () => {
      store.getState().importGltf(
        'data:base64...',
        'model.glb',
        undefined,
        '4ec30cf9-d98f-4e67-86d9-470a6cdbbe09',
      );

      expect(mockDispatch).toHaveBeenCalledWith('import_gltf', expect.objectContaining({
        id: '4ec30cf9-d98f-4e67-86d9-470a6cdbbe09',
      }));
    });
  });

  describe('loadTexture', () => {
    it('should dispatch only', () => {
      const outcome = store.getState().loadTexture(PNG_DATA_URL, 'texture.png', 'entity1', 'base_color_texture');

      expect(mockDispatch).toHaveBeenCalledWith('load_texture', {
        dataBase64: PNG_DATA_URL,
        name: 'texture.png',
        entityId: 'entity1',
        slot: 'base_color_texture',
      });
      expect(outcome).toEqual({ success: true });
      expect(showPersistentError).not.toHaveBeenCalled();
    });

    it('still sends a raw base64 body, which the engine decodes as PNG', () => {
      store.getState().loadTexture('iVBORw0KGgo=', 'texture.png', 'entity1', 'base_color');

      expect(mockDispatch).toHaveBeenCalledWith('load_texture', expect.objectContaining({
        dataBase64: 'iVBORw0KGgo=',
      }));
    });

    it('refuses a KTX2 data URL before the command is built, naming the accepted formats', () => {
      const outcome = store.getState().loadTexture(KTX2_DATA_URL, 'lut.ktx2', 'entity1', 'base_color');

      expect(mockDispatch).not.toHaveBeenCalled();
      expect(outcome).toEqual({ success: false, error: KTX2_REFUSAL });
      expect(showPersistentError).toHaveBeenCalledWith(
        `Couldn't load the texture: ${KTX2_REFUSAL}`,
        { id: 'load_texture-refused' },
      );
    });

    it('refuses WebP by name - the pickers accept .webp files, the engine has no decoder for them', () => {
      const outcome = store.getState().loadTexture('data:image/webp;base64,UklGRg==', 'photo.webp', 'entity1', 'base_color');

      expect(mockDispatch).not.toHaveBeenCalled();
      expect(outcome).toEqual({
        success: false,
        error: "unsupported texture format 'image/webp'; accepted formats are image/png, image/jpeg",
      });
    });

    it('refuses even when no dispatcher is attached', () => {
      setAssetDispatcher(null as unknown as (command: string, payload: unknown) => void);

      const outcome = store.getState().loadTexture(KTX2_DATA_URL, 'lut.ktx2', 'entity1', 'base_color');

      expect(outcome).toEqual({ success: false, error: KTX2_REFUSAL });
    });

    it('shows the engine\'s own refusal of a texture, and returns it', () => {
      // The engine enforces the cap the slice does not: its answer is relayed.
      mockDispatch.mockReturnValue({
        success: false,
        error: 'load_texture refused: payload is 67500001 bytes of base64, over the 50 MB limit',
      });

      const outcome = store.getState().loadTexture(PNG_DATA_URL, 'huge.png', 'entity1', 'base_color');

      expect(outcome).toEqual({
        success: false,
        error: 'payload is 67500001 bytes of base64, over the 50 MB limit',
      });
      expect(showPersistentError).toHaveBeenCalledWith(
        "Couldn't load the texture: payload is 67500001 bytes of base64, over the 50 MB limit",
        { id: 'load_texture-refused' },
      );
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

    it('forwards an optional stable asset id', () => {
      store.getState().importAudio(
        REAL_BASE64,
        'sound.mp3',
        '7ace805c-ff9f-4a4d-89e8-4d3ea890fa4e',
      );

      expect(mockDispatch).toHaveBeenCalledWith('import_audio', expect.objectContaining({
        id: '7ace805c-ff9f-4a4d-89e8-4d3ea890fa4e',
      }));
    });

    it('holds the decoded bytes under the import name', () => {
      // Legacy callers omit an id, so the engine still mints one and `name`
      // remains the correlation key for the ASSET_IMPORTED that follows.
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
