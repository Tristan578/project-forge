/**
 * The words for each reason `loadScene()` answers `false`. Pinned
 * byte-for-byte: the auto-save restore, the toolbar import and the
 * `load_scene` / `switch_scene` tools all compose their sentence from this
 * clause, so a change here changes what four surfaces tell the person.
 */
import { describe, it, expect } from 'vitest';
import { describeSceneLoadRefusal, type SceneLoadRefusal } from '../sceneLoadRefusal';

describe('describeSceneLoadRefusal', () => {
  it('relays the engine reason it was given', () => {
    expect(describeSceneLoadRefusal({ kind: 'engine_refused', details: 'Missing field `entities`.' }))
      .toBe('The engine refused to load it. Details: Missing field `entities`.');
  });

  it('says the engine gave no detail rather than inventing one', () => {
    expect(describeSceneLoadRefusal({ kind: 'engine_refused', details: null }))
      .toBe('The engine refused to load it and gave no further detail.');
  });

  it('names the prefab data, not the engine, when the prefab data was refused', () => {
    const sentence = describeSceneLoadRefusal({ kind: 'prefab_invalid' });
    expect(sentence).toBe('Its prefab data is invalid or its prefab references form a cycle.');
    expect(sentence).not.toContain('engine');
  });

  it('reads a missing refusal as no engine attached yet', () => {
    expect(describeSceneLoadRefusal(null)).toBe('The engine is not ready yet — try again in a moment.');
  });

  it('ends every clause in a full stop, so callers can append their next step', () => {
    const refusals: Array<SceneLoadRefusal | null> = [
      { kind: 'engine_refused', details: 'Missing field `entities`.' },
      { kind: 'engine_refused', details: null },
      { kind: 'prefab_invalid' },
      null,
    ];
    for (const refusal of refusals) expect(describeSceneLoadRefusal(refusal)).toMatch(/\.$/);
  });
});
