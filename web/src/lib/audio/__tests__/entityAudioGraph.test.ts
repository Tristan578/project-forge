import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AudioData } from '@/stores/slices/types';

const loadBuffer = vi.fn<(assetId: string, data: ArrayBuffer) => Promise<void>>();
const createInstance = vi.fn();
const destroyInstance = vi.fn();

vi.mock('../audioManager', () => ({
  audioManager: {
    loadBuffer: (assetId: string, data: ArrayBuffer) => loadBuffer(assetId, data),
    createInstance: (...args: unknown[]) => createInstance(...args),
    destroyInstance: (...args: unknown[]) => destroyInstance(...args),
  },
}));

const {
  decodeBase64ToArrayBuffer,
  ingestImportedAudioAsset,
  queueAudioImport,
  registerImportedAudioAsset,
  resetEntityAudioGraph,
  resolveAudioAssetId,
  syncEntitiesUsingAudioAsset,
  syncEntityAudioInstance,
  takeAudioImport,
} = await import('../entityAudioGraph');

const audio = (over: Partial<AudioData> = {}): AudioData => ({
  assetId: 'asset-1',
  volume: 1,
  pitch: 1,
  loopAudio: false,
  spatial: false,
  maxDistance: 50,
  refDistance: 1,
  rolloffFactor: 1,
  autoplay: false,
  bus: 'sfx',
  ...over,
});

const bytes = (n: number) => new Uint8Array(n).fill(1).buffer;

beforeEach(() => {
  resetEntityAudioGraph();
  loadBuffer.mockReset().mockResolvedValue(undefined);
  createInstance.mockReset();
  destroyInstance.mockReset();
});

describe('decodeBase64ToArrayBuffer', () => {
  it('decodes the exact bytes, not a re-encoding of them', () => {
    // 0x00 and 0xff are the two values a charCodeAt/String round-trip is most
    // likely to mangle, and a length that is not a multiple of 3 exercises
    // base64 padding.
    const decoded = decodeBase64ToArrayBuffer(btoa('\x00\x01\xff\x7f'));
    expect([...new Uint8Array(decoded!)]).toEqual([0x00, 0x01, 0xff, 0x7f]);
  });

  it('strips a data-URL prefix', () => {
    const decoded = decodeBase64ToArrayBuffer(`data:audio/wav;base64,${btoa('ab')}`);
    expect([...new Uint8Array(decoded!)]).toEqual([0x61, 0x62]);
  });

  it('returns null rather than throwing on a payload atob rejects', () => {
    // The caller dispatches to the engine either way — the engine owns the
    // asset metadata the scene is built from. A clip we cannot decode is a
    // silent clip, not a failed import.
    expect(decodeBase64ToArrayBuffer('not valid base64!!')).toBeNull();
    expect(decodeBase64ToArrayBuffer('')).toBeNull();
    expect(decodeBase64ToArrayBuffer('data:audio/wav;base64,')).toBeNull();
  });
});

describe('the pending-import queue', () => {
  it('hands back the bytes queued under a name', () => {
    const data = bytes(4);
    queueAudioImport('shot.wav', data);
    expect(takeAudioImport('shot.wav')).toBe(data);
  });

  it('takes once, because decodeAudioData detaches the buffer it is given', () => {
    queueAudioImport('shot.wav', bytes(4));
    expect(takeAudioImport('shot.wav')).not.toBeNull();
    expect(takeAudioImport('shot.wav')).toBeNull();
  });

  it('returns null for a name that was never queued', () => {
    expect(takeAudioImport('never.wav')).toBeNull();
  });

  it('serves same-named imports in dispatch order', () => {
    // Two files may legitimately share a name; the engine mints a distinct id
    // for each and the events arrive in the order the imports were dispatched.
    const first = bytes(1);
    const second = bytes(2);
    queueAudioImport('shot.wav', first);
    queueAudioImport('shot.wav', second);

    expect(takeAudioImport('shot.wav')).toBe(first);
    expect(takeAudioImport('shot.wav')).toBe(second);
  });

  it('drops the oldest unclaimed import rather than growing without bound', () => {
    // Each entry pins a whole decoded file. An ASSET_IMPORTED that never
    // arrives must not leak one forever.
    const oldest = bytes(1);
    queueAudioImport('oldest.wav', oldest);
    for (let i = 0; i < 32; i++) queueAudioImport(`later-${i}.wav`, bytes(1));

    expect(takeAudioImport('oldest.wav')).toBeNull();
    expect(takeAudioImport('later-0.wav')).not.toBeNull();
  });
});

describe('resolveAudioAssetId', () => {
  it('maps an import name onto the id the engine minted for it', () => {
    // The generation handlers set `assetId` to the name they imported under,
    // while the registry keys the engine's uuid. Without this the buffer and
    // the entity never meet.
    registerImportedAudioAsset('uuid-1', 'sfx-laser');
    expect(resolveAudioAssetId('sfx-laser')).toBe('uuid-1');
  });

  it('passes a real asset id through untouched', () => {
    expect(resolveAudioAssetId('uuid-1')).toBe('uuid-1');
  });
});

describe('syncEntityAudioInstance', () => {
  it('creates an instance under the resolved asset id', () => {
    registerImportedAudioAsset('uuid-1', 'sfx-laser');
    const data = audio({ assetId: 'sfx-laser', volume: 0.5 });

    syncEntityAudioInstance('e1', data);

    expect(createInstance).toHaveBeenCalledWith('e1', 'uuid-1', data);
  });

  it('destroys the instance when the entity loses its audio', () => {
    syncEntityAudioInstance('e1', null);
    expect(destroyInstance).toHaveBeenCalledWith('e1');
    expect(createInstance).not.toHaveBeenCalled();
  });

  it('destroys the instance when the entity keeps AudioData but no clip', () => {
    // `AUDIO_CHANGED` reports `assetId: null` for an audio component whose clip
    // was cleared. Creating an instance for it would key the buffer map on the
    // string "null".
    syncEntityAudioInstance('e1', audio({ assetId: null }));
    expect(destroyInstance).toHaveBeenCalledWith('e1');
    expect(createInstance).not.toHaveBeenCalled();
  });
});

describe('syncEntitiesUsingAudioAsset', () => {
  it('re-creates only the entities pointing at that asset', () => {
    registerImportedAudioAsset('uuid-1', 'sfx-laser');

    syncEntitiesUsingAudioAsset('uuid-1', {
      byName: audio({ assetId: 'sfx-laser' }),
      byId: audio({ assetId: 'uuid-1' }),
      other: audio({ assetId: 'uuid-2' }),
      silent: audio({ assetId: null }),
    });

    expect(createInstance.mock.calls.map(c => c[0])).toEqual(['byName', 'byId']);
  });
});

describe('ingestImportedAudioAsset', () => {
  it('decodes the queued bytes under the id the engine minted', async () => {
    const data = bytes(8);
    queueAudioImport('shot.wav', data);

    await ingestImportedAudioAsset('uuid-1', 'shot.wav', () => ({}));

    expect(loadBuffer).toHaveBeenCalledWith('uuid-1', data);
  });

  it('wires up an entity that was assigned the clip before the bytes landed', async () => {
    // The ordering this exists for: a scene load gives entities their AudioData
    // before any buffer is decoded. Whichever arrived first would otherwise be
    // the one that silently lost.
    queueAudioImport('shot.wav', bytes(8));

    await ingestImportedAudioAsset('uuid-1', 'shot.wav', () => ({
      e1: audio({ assetId: 'shot.wav' }),
    }));

    expect(createInstance).toHaveBeenCalledWith('e1', 'uuid-1', expect.anything());
  });

  it('reads the entity audio AFTER the decode, not before', async () => {
    // The getter is not a convenience: the store can gain an entity while
    // decodeAudioData is still running, and a snapshot taken up front misses it.
    queueAudioImport('shot.wav', bytes(8));
    let entities: Record<string, AudioData> = {};
    loadBuffer.mockImplementation(async () => {
      entities = { late: audio({ assetId: 'shot.wav' }) };
    });

    await ingestImportedAudioAsset('uuid-1', 'shot.wav', () => entities);

    expect(createInstance).toHaveBeenCalledWith('late', 'uuid-1', expect.anything());
  });

  it('does nothing for an asset JS never imported', async () => {
    // ASSET_LIST/ASSET_IMPORTED also fire for assets that came from a loaded
    // scene. There are no bytes to claim and nothing to warn about.
    await ingestImportedAudioAsset('uuid-1', 'from-scene.wav', () => ({}));

    expect(loadBuffer).not.toHaveBeenCalled();
    expect(createInstance).not.toHaveBeenCalled();
  });

  it('swallows a decode failure instead of rejecting into an event handler', async () => {
    queueAudioImport('shot.wav', bytes(8));
    loadBuffer.mockRejectedValue(new Error('EncodingError'));

    await expect(
      ingestImportedAudioAsset('uuid-1', 'shot.wav', () => ({
        e1: audio({ assetId: 'shot.wav' }),
      }))
    ).resolves.toBeUndefined();

    // And it does not go on to create an instance whose buffer does not exist.
    expect(createInstance).not.toHaveBeenCalled();
  });
});
