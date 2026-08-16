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

  it('replaces a stash the engine never confirmed', () => {
    stageSceneAudio(scene([{ entityId: 'old', audioData: FULL_AUDIO }]));
    stageSceneAudio(scene([{ entityId: 'new', audioData: FULL_AUDIO }]));

    expect(takeStagedSceneAudio()).toEqual({ new: FULL_AUDIO });
  });
});
