import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AudioData } from '@/stores/slices/types';

const loadBuffer = vi.fn<(assetId: string, data: ArrayBuffer) => Promise<void>>();
const createInstance = vi.fn();
const destroyInstance = vi.fn();
const destroyAll = vi.fn();
const releaseBuffer = vi.fn();

vi.mock('../audioManager', () => ({
  audioManager: {
    loadBuffer: (assetId: string, data: ArrayBuffer) => loadBuffer(assetId, data),
    createInstance: (...args: unknown[]) => createInstance(...args),
    destroyInstance: (...args: unknown[]) => destroyInstance(...args),
    destroyAll: (...args: unknown[]) => destroyAll(...args),
    releaseBuffer: (...args: unknown[]) => releaseBuffer(...args),
  },
}));

const {
  decodeBase64ToArrayBuffer,
  forgetImportedAudioAsset,
  ingestImportedAudioAsset,
  queueAudioImport,
  registerImportedAudioAsset,
  releaseEntityAudio,
  resetEntityAudioGraph,
  resetEntityAudioGraphForScene,
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
  destroyAll.mockReset();
  releaseBuffer.mockReset();
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

  it('returns null for a value that is not a string at all', () => {
    // The parameter is `unknown` because the payload comes off a provider
    // response. A number or an object would otherwise reach `atob`, which
    // stringifies rather than rejecting — `atob(null)` is a valid call.
    expect(decodeBase64ToArrayBuffer(undefined)).toBeNull();
    expect(decodeBase64ToArrayBuffer(null)).toBeNull();
    expect(decodeBase64ToArrayBuffer(42)).toBeNull();
    expect(decodeBase64ToArrayBuffer({ data: btoa('ab') })).toBeNull();
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

  it('keeps a full queue of 32 — the cap is what it evicts past, not at', () => {
    // The off-by-one here is the difference between an eviction policy and a
    // bug that drops the first import of every batch of 32.
    for (let i = 0; i < 32; i++) queueAudioImport(`clip-${i}.wav`, bytes(1));

    for (let i = 0; i < 32; i++) {
      expect(takeAudioImport(`clip-${i}.wav`)).not.toBeNull();
    }
  });

  it('evicts by age, not by name, when imports of different names interleave', () => {
    // Eviction walks the queue from the front; it does not group by name. A
    // young entry must survive an eviction triggered by an unrelated import.
    queueAudioImport('old.wav', bytes(1));
    queueAudioImport('young.wav', bytes(1));
    for (let i = 0; i < 31; i++) queueAudioImport(`filler-${i}.wav`, bytes(1));

    expect(takeAudioImport('old.wav')).toBeNull();
    expect(takeAudioImport('young.wav')).not.toBeNull();
  });

  it('evicts on total bytes as well as entry count', () => {
    // 32 small entries never reach the count cap, but a decoded audio file is
    // megabytes — the byte budget is the bound that actually matters for memory.
    const big = 24 * 1024 * 1024;
    queueAudioImport('first.wav', bytes(big));
    queueAudioImport('second.wav', bytes(big));
    queueAudioImport('third.wav', bytes(big));

    expect(takeAudioImport('first.wav')).toBeNull();
    expect(takeAudioImport('second.wav')).not.toBeNull();
    expect(takeAudioImport('third.wav')).not.toBeNull();
  });

  it('keeps an import that busts the byte budget on its own', () => {
    // Otherwise a single oversized clip would evict itself the instant it was
    // queued, and the ASSET_IMPORTED that follows would find nothing.
    queueAudioImport('huge.wav', bytes(65 * 1024 * 1024));
    expect(takeAudioImport('huge.wav')).not.toBeNull();
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

  it('rebinds a name that is imported a second time', () => {
    // Re-importing a file under a name already in use is what the asset panel
    // means by replacing it — the alias has to follow the newer asset.
    registerImportedAudioAsset('uuid-1', 'sfx-laser');
    registerImportedAudioAsset('uuid-2', 'sfx-laser');
    expect(resolveAudioAssetId('sfx-laser')).toBe('uuid-2');
  });
});

describe('forgetImportedAudioAsset', () => {
  it('drops every alias pointing at the deleted asset', () => {
    // A name kept after its asset is deleted resolves to a dead id, which
    // hands `createInstance` an id with no buffer — a permanently silent
    // entity rather than one that falls back to the name.
    registerImportedAudioAsset('uuid-1', 'sfx-laser');
    registerImportedAudioAsset('uuid-1', 'sfx-laser-copy');
    registerImportedAudioAsset('uuid-2', 'sfx-hum');

    forgetImportedAudioAsset('uuid-1');

    expect(resolveAudioAssetId('sfx-laser')).toBe('sfx-laser');
    expect(resolveAudioAssetId('sfx-laser-copy')).toBe('sfx-laser-copy');
    expect(resolveAudioAssetId('sfx-hum')).toBe('uuid-2');
  });

  it('does nothing for an asset with no aliases', () => {
    registerImportedAudioAsset('uuid-1', 'sfx-laser');
    expect(() => forgetImportedAudioAsset('uuid-never')).not.toThrow();
    expect(resolveAudioAssetId('sfx-laser')).toBe('uuid-1');
  });
});

describe('releaseEntityAudio', () => {
  it('destroys the instance and forgets the applied state', () => {
    // The engine emits no per-entity audio delete, so removal is driven from
    // here. Forgetting the signature matters as much as the teardown: an id
    // reused by a later scene must not be mistaken for already-applied.
    const data = audio();
    syncEntityAudioInstance('e1', data);
    createInstance.mockClear();

    releaseEntityAudio('e1');
    expect(destroyInstance).toHaveBeenCalledWith('e1');

    syncEntityAudioInstance('e1', data);
    expect(createInstance).toHaveBeenCalledWith('e1', 'asset-1', data);
  });
});

describe('resetEntityAudioGraphForScene', () => {
  it('tears down every instance as well as the module state', () => {
    // Instances outlive a scene load otherwise — they are keyed by an entity id
    // the incoming scene will reuse for something else entirely.
    queueAudioImport('shot.wav', bytes(4));
    registerImportedAudioAsset('uuid-1', 'sfx-laser');
    syncEntityAudioInstance('e1', audio());
    createInstance.mockClear();

    resetEntityAudioGraphForScene();

    expect(destroyAll).toHaveBeenCalled();
    expect(takeAudioImport('shot.wav')).toBeNull();

    // And the applied-signature record is gone, so the same component rebuilds.
    syncEntityAudioInstance('e1', audio());
    expect(createInstance).toHaveBeenCalledTimes(1);
  });

  it('releases the decoded buffer when the asset itself is deleted', () => {
    // Nothing else ever deleted from the buffer map, so an imported-then-deleted
    // clip stayed decoded for the life of the tab. Asset deletion is the one
    // moment the buffer is provably unreachable.
    registerImportedAudioAsset('uuid-1', 'sfx-laser');

    forgetImportedAudioAsset('uuid-1');

    expect(releaseBuffer).toHaveBeenCalledWith('uuid-1');
    expect(resolveAudioAssetId('sfx-laser')).toBe('sfx-laser');
  });

  it('does not release buffers on a scene change', () => {
    // The mirror of the alias rule below: buffers are asset-lifetime state, and
    // dropping them here would silence every clip with no path to re-decode.
    registerImportedAudioAsset('uuid-1', 'sfx-laser');

    resetEntityAudioGraphForScene();

    expect(releaseBuffer).not.toHaveBeenCalled();
  });

  it('keeps the name aliases, which outlive the scene that used them', () => {
    // `destroyAll` destroys instances, never the decoded buffers, so the buffer
    // is still loaded under `uuid-1` after this. Dropping the alias would leave
    // every AI-attached clip — which points at the import NAME — resolving to a
    // name no buffer is keyed by, i.e. permanently silent. The alias is torn
    // down when the ASSET goes away, which is `forgetImportedAudioAsset`.
    registerImportedAudioAsset('uuid-1', 'sfx-laser');

    resetEntityAudioGraphForScene();

    expect(resolveAudioAssetId('sfx-laser')).toBe('uuid-1');
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

  it('does not rebuild for a component that has not changed', () => {
    // `createInstance` is destructive — it tears down the instance and every
    // layer on it. The engine re-emits AUDIO_CHANGED on every selection change
    // and every audio query, so without this guard clicking an entity in the
    // hierarchy during Play would stop its own music.
    syncEntityAudioInstance('e1', audio());
    syncEntityAudioInstance('e1', audio());

    expect(createInstance).toHaveBeenCalledTimes(1);
  });

  it('rebuilds when any field of the component changes', () => {
    // The signature covers the whole component, not just the clip: volume and
    // spatial settings are baked into the nodes at creation.
    syncEntityAudioInstance('e1', audio());
    syncEntityAudioInstance('e1', audio({ volume: 0.5 }));

    expect(createInstance).toHaveBeenCalledTimes(2);
  });

  it('guards each entity separately', () => {
    syncEntityAudioInstance('e1', audio());
    syncEntityAudioInstance('e2', audio());

    expect(createInstance.mock.calls.map(c => c[0])).toEqual(['e1', 'e2']);
  });

  it('rebuilds an unchanged component when forced', () => {
    // The one case the guard has to yield to: the component never changed, the
    // buffer is what just arrived, and the earlier create bailed on a missing one.
    syncEntityAudioInstance('e1', audio());
    syncEntityAudioInstance('e1', audio(), { force: true });

    expect(createInstance).toHaveBeenCalledTimes(2);
  });

  it('does not repeat a teardown for an entity that already has no clip', () => {
    syncEntityAudioInstance('e1', null);
    syncEntityAudioInstance('e1', null);

    expect(destroyInstance).toHaveBeenCalledTimes(1);
  });

  it('rebuilds when a late-registered alias moves the entity onto a real buffer', () => {
    // Ordering that happens on every generated clip: the component lands
    // pointing at the import name before ASSET_IMPORTED registers the alias, so
    // the first create keys the name and the second has to key the uuid.
    syncEntityAudioInstance('e1', audio({ assetId: 'sfx-laser' }));
    registerImportedAudioAsset('uuid-1', 'sfx-laser');
    syncEntityAudioInstance('e1', audio({ assetId: 'sfx-laser' }));

    expect(createInstance.mock.calls.map(c => c[1])).toEqual(['sfx-laser', 'uuid-1']);
  });
});

describe('syncEntitiesUsingAudioAsset', () => {
  it('re-creates only the entities pointing at that asset, under its real id', () => {
    // Both matching entities must be keyed on the uuid the buffer was decoded
    // under — the one that spelled it as the import name included. Asserting
    // the entity ids alone would pass even if the alias were never resolved.
    registerImportedAudioAsset('uuid-1', 'sfx-laser');
    const byName = audio({ assetId: 'sfx-laser' });
    const byId = audio({ assetId: 'uuid-1' });

    syncEntitiesUsingAudioAsset('uuid-1', {
      byName,
      byId,
      other: audio({ assetId: 'uuid-2' }),
      silent: audio({ assetId: null }),
    });

    expect(createInstance.mock.calls).toEqual([
      ['byName', 'uuid-1', byName],
      ['byId', 'uuid-1', byId],
    ]);
  });

  it('rebuilds entities whose component was already applied', () => {
    // This is the whole point of the forced sync: the components did not
    // change, the buffer did, so the guard has to be bypassed or the entities
    // that were created before the decode stay silent forever.
    const data = audio();
    syncEntityAudioInstance('e1', data);
    createInstance.mockClear();

    syncEntitiesUsingAudioAsset('asset-1', { e1: data });

    expect(createInstance).toHaveBeenCalledWith('e1', 'asset-1', data);
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
    const data = audio({ assetId: 'shot.wav', volume: 0.25, spatial: true });

    await ingestImportedAudioAsset('uuid-1', 'shot.wav', () => ({ e1: data }));

    // The whole component has to reach `createInstance` — volume and the
    // spatial settings are baked into the nodes at creation, so a sync that
    // dropped them would build a mono clip at full volume.
    expect(createInstance).toHaveBeenCalledWith('e1', 'uuid-1', data);
  });

  it('reads the entity audio AFTER the decode, not before', async () => {
    // The getter is not a convenience: the store can gain an entity while
    // decodeAudioData is still running, and a snapshot taken up front misses it.
    queueAudioImport('shot.wav', bytes(8));
    const data = audio({ assetId: 'shot.wav', loopAudio: true });
    let entities: Record<string, AudioData> = {};
    loadBuffer.mockImplementation(async () => {
      entities = { late: data };
    });

    await ingestImportedAudioAsset('uuid-1', 'shot.wav', () => entities);

    expect(createInstance).toHaveBeenCalledWith('late', 'uuid-1', data);
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
