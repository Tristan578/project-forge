/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseSceneAudio,
  stageSceneAudio,
  takeStagedSceneAudio,
  clearStagedSceneAudio,
} from '../sceneAudioManifest';

/** The shape the engine serializes: camelCase, `audioData` omitted when absent. */
function scene(entities: unknown[]): string {
  return JSON.stringify({ formatVersion: 1, metadata: { name: 'Level 1' }, entities });
}

const FULL_AUDIO = {
  assetId: 'asset-1',
  volume: 0.4,
  pitch: 1.2,
  loopAudio: true,
  spatial: true,
  maxDistance: 25,
  refDistance: 2,
  rolloffFactor: 1.5,
  autoplay: true,
  bus: 'music',
};

describe('parseSceneAudio', () => {
  it('keys every entity that declares audio by its entity id', () => {
    const audio = parseSceneAudio(
      scene([
        { entityId: 'e1', name: 'Speaker', audioData: FULL_AUDIO },
        { entityId: 'e2', name: 'Cube' },
      ])
    );

    // Full equality, not `objectContaining`: this map IS what the inspector,
    // the accessibility audit and the AI's scene context read.
    expect(audio).toEqual({ e1: FULL_AUDIO });
  });

  it('drops keys the scene file invented rather than spreading them into state', () => {
    const audio = parseSceneAudio(
      scene([{ entityId: 'e1', audioData: { ...FULL_AUDIO, evil: 'payload' } }])
    );

    expect(audio.e1).toEqual(FULL_AUDIO);
    expect('evil' in audio.e1).toBe(false);
  });

  it('falls back to the engine defaults for values of the wrong type', () => {
    const audio = parseSceneAudio(
      scene([
        {
          entityId: 'e1',
          audioData: {
            assetId: 42,
            volume: 'loud',
            pitch: NaN,
            maxDistance: Infinity,
            loopAudio: 'yes',
            bus: '',
          },
        },
      ])
    );

    expect(audio.e1).toEqual({
      assetId: null,
      volume: 1.0,
      pitch: 1.0,
      loopAudio: false,
      spatial: false,
      maxDistance: 50.0,
      refDistance: 1.0,
      rolloffFactor: 1.0,
      autoplay: false,
      bus: 'sfx',
    });
  });

  it('does not let a scene file name an entity after a prototype key', () => {
    // `audio['__proto__'] = x` swaps the prototype instead of adding a key, so
    // an unguarded parse would make every entity in the scene report this
    // sound through the prototype chain.
    const audio = parseSceneAudio(
      scene([
        { entityId: '__proto__', audioData: FULL_AUDIO },
        { entityId: 'constructor', audioData: FULL_AUDIO },
        { entityId: 'real-entity', audioData: { volume: 0.25 } },
      ])
    );

    expect(Object.keys(audio)).toEqual(['real-entity']);
    expect(audio['some-entity-with-no-sound']).toBeUndefined();
    expect(Object.getPrototypeOf(audio)).toBe(Object.prototype);
  });

  it('drops an entity id no engine would ever mint', () => {
    // Ids are uuids. An oversized one is a scene file trying to write into the
    // AI scene context, which renders an unnamed entity by its raw id.
    const audio = parseSceneAudio(
      scene([
        { entityId: 'x'.repeat(129), audioData: FULL_AUDIO },
        { entityId: 'x'.repeat(128), audioData: { volume: 0.25 } },
      ])
    );

    expect(Object.keys(audio)).toEqual(['x'.repeat(128)]);
  });

  it('keeps a zero volume, which a truthiness check would have thrown away', () => {
    const audio = parseSceneAudio(scene([{ entityId: 'e1', audioData: { volume: 0 } }]));
    expect(audio.e1.volume).toBe(0);
  });

  it('skips entries with no usable entity id', () => {
    const audio = parseSceneAudio(
      scene([
        { entityId: '', audioData: FULL_AUDIO },
        { entityId: 7, audioData: FULL_AUDIO },
        { audioData: FULL_AUDIO },
        null,
      ])
    );

    expect(audio).toEqual({});
  });

  it('returns nothing rather than throwing on a scene it cannot read', () => {
    // A throw here would abort loadScene before it dispatched, losing the scene
    // entirely — a far worse outcome than an unlisted sound.
    expect(parseSceneAudio('not json')).toEqual({});
    expect(parseSceneAudio('null')).toEqual({});
    expect(parseSceneAudio('[]')).toEqual({});
    expect(parseSceneAudio(JSON.stringify({ entities: 'nope' }))).toEqual({});
    expect(parseSceneAudio(JSON.stringify({}))).toEqual({});
  });
});

describe('staging', () => {
  beforeEach(() => {
    clearStagedSceneAudio();
  });

  it('hands the staged audio over exactly once', () => {
    stageSceneAudio(scene([{ entityId: 'e1', audioData: FULL_AUDIO }]));

    expect(takeStagedSceneAudio()).toEqual({ e1: FULL_AUDIO });
    // new_scene emits the same SCENE_LOADED a load does. A stash that survived
    // being taken would reattach this audio to an empty scene's dead ids.
    expect(takeStagedSceneAudio()).toEqual({});
  });

  it('is cleared without being taken', () => {
    stageSceneAudio(scene([{ entityId: 'e1', audioData: FULL_AUDIO }]));
    clearStagedSceneAudio();

    expect(takeStagedSceneAudio()).toEqual({});
  });

  it.each(['load', 'new'] as const)('does not resurrect consumed audio when a %s request rolls back', (operation) => {
    stageSceneAudio(scene([{ entityId: 'previous', audioData: FULL_AUDIO }]));
    const rollback = operation === 'load'
      ? stageSceneAudio(scene([{ entityId: 'incoming', audioData: FULL_AUDIO }]))
      : clearStagedSceneAudio();
    expect(takeStagedSceneAudio()).toEqual(operation === 'load' ? { incoming: FULL_AUDIO } : {});
    rollback();
    expect(takeStagedSceneAudio()).toEqual({});
  });

  it.each(['load', 'new'] as const)('preserves a newer staging when a %s request rolls back', (operation) => {
    stageSceneAudio(scene([{ entityId: 'previous', audioData: FULL_AUDIO }]));
    const rollback = operation === 'load'
      ? stageSceneAudio(scene([{ entityId: 'incoming', audioData: FULL_AUDIO }]))
      : clearStagedSceneAudio();
    stageSceneAudio(scene([{ entityId: 'newer', audioData: FULL_AUDIO }]));
    rollback();
    expect(takeStagedSceneAudio()).toEqual({ newer: FULL_AUDIO });
  });

  it('replaces a stash the engine never confirmed', () => {
    stageSceneAudio(scene([{ entityId: 'old', audioData: FULL_AUDIO }]));
    stageSceneAudio(scene([{ entityId: 'new', audioData: FULL_AUDIO }]));

    expect(takeStagedSceneAudio()).toEqual({ new: FULL_AUDIO });
  });
});

// ---------------------------------------------------------------------------
// Clip documents (trim/fade/gain/loop) — #9903, operation audio.FR-1.OP-02
// ---------------------------------------------------------------------------

import {
  parseSceneClipDocuments,
  readClipDocument,
  serializeClipDocument,
} from '../sceneAudioManifest';
import {
  AUDIO_CLIP_DOCUMENT_VERSION,
  type AudioClipDocument,
} from '../audioClipDocument';

const FULL_CLIP: AudioClipDocument = {
  version: AUDIO_CLIP_DOCUMENT_VERSION,
  sourceAssetId: 'asset-1',
  sourceHash: 'deadbeef',
  trimStartSec: 0.25,
  trimEndSec: 1.75,
  gainDb: -6,
  fadeInSec: 0.1,
  fadeOutSec: 0.2,
  loopStartSec: 0.5,
  loopEndSec: 1.5,
};

describe('clip document persistence (audio.FR-1.OP-02)', () => {
  it('round-trips a full clip document through serialize -> read unchanged', () => {
    const restored = readClipDocument(serializeClipDocument(FULL_CLIP));
    expect(restored).toEqual(FULL_CLIP);
  });

  it('reads clip documents out of a scene keyed by entity id', () => {
    const clips = parseSceneClipDocuments(
      scene([
        { entityId: 'e1', audioData: { ...FULL_AUDIO, clip: serializeClipDocument(FULL_CLIP) } },
        { entityId: 'e2', audioData: FULL_AUDIO },
      ])
    );
    expect(clips).toEqual({ e1: FULL_CLIP });
  });

  it('leaves an OLD manifest (no clip key) unchanged — no clips, audio intact', () => {
    // The backward-compat guarantee: a scene saved before clips existed reads
    // back with zero clip documents and its AudioData untouched.
    const oldScene = scene([{ entityId: 'e1', audioData: FULL_AUDIO }]);
    expect(parseSceneClipDocuments(oldScene)).toEqual({});
    expect(parseSceneAudio(oldScene)).toEqual({ e1: FULL_AUDIO });
  });

  it('drops a degenerate clip (missing/reversed window or no source) rather than fabricate one', () => {
    expect(readClipDocument(null)).toBeNull();
    expect(readClipDocument({ trimStartSec: 0, trimEndSec: 1 })).toBeNull(); // no source
    expect(readClipDocument({ sourceAssetId: 'a', trimStartSec: 1, trimEndSec: 1 })).toBeNull(); // empty
    expect(readClipDocument({ sourceAssetId: 'a', trimStartSec: 1, trimEndSec: 0.5 })).toBeNull(); // reversed
    expect(readClipDocument({ sourceAssetId: 'a', trimStartSec: 0 })).toBeNull(); // no end
  });

  it('defaults optional numeric fields and coerces bad types safely', () => {
    const clip = readClipDocument({
      sourceAssetId: 'a',
      trimStartSec: 0,
      trimEndSec: 2,
      gainDb: 'loud',
      fadeInSec: undefined,
      fadeOutSec: NaN,
    });
    expect(clip).toEqual({
      version: AUDIO_CLIP_DOCUMENT_VERSION,
      sourceAssetId: 'a',
      sourceHash: '',
      trimStartSec: 0,
      trimEndSec: 2,
      gainDb: 0,
      fadeInSec: 0,
      fadeOutSec: 0,
      loopStartSec: 0,
      loopEndSec: 2,
    });
  });

  it('ignores a clip named __proto__ etc. via the same reserved-id guard', () => {
    const clips = parseSceneClipDocuments(
      scene([{ entityId: '__proto__', audioData: { clip: serializeClipDocument(FULL_CLIP) } }])
    );
    expect(clips).toEqual({});
    expect(Object.getPrototypeOf(clips)).toBe(Object.prototype);
  });

  it.each([
    { version: 999 },
    { version: '1' },
    { trimStartSec: -1 },
    { gainDb: -61 },
    { gainDb: 25 },
    { fadeInSec: -0.1 },
    { fadeOutSec: -0.1 },
    { fadeInSec: 1.4 }, // Existing fade-out makes the combined fades too long.
    { fadeOutSec: 1.5 },
    { loopStartSec: 0 },
    { loopEndSec: 2 },
    { loopStartSec: 1.5 }, // Equal loop boundaries.
    { loopEndSec: 0.4 }, // Reversed loop.
  ])('rejects an invalid clip field %j without adopting the document', (patch) => {
    expect(readClipDocument({ ...FULL_CLIP, ...patch })).toBeNull();
    expect(parseSceneClipDocuments(scene([
      { entityId: 'valid', audioData: { clip: FULL_CLIP } },
      { entityId: 'invalid', audioData: { clip: { ...FULL_CLIP, ...patch } } },
    ]))).toEqual({ valid: FULL_CLIP });
  });
});
