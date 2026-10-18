/**
 * The words for each reason `newScene()` answers `false` (#10202 review,
 * round 2). Pinned byte-for-byte: the toolbar, the template gallery, the
 * `new_scene` / `switch_scene` / `create_scene_from_description` tools and
 * `scene_create` all compose their sentence from this clause, and the two
 * reasons that are not the engine's must never read as if they were.
 */
import { describe, it, expect } from 'vitest';
import { describeNewSceneRefusal, type NewSceneRefusal } from '../newSceneRefusal';

describe('describeNewSceneRefusal', () => {
  it('blames the engine only for the engine refusing', () => {
    expect(describeNewSceneRefusal('engine_refused')).toBe('The engine did not accept a new scene.');
  });

  it('says the engine is not ready, not that it refused, when none is attached yet', () => {
    expect(describeNewSceneRefusal('engine_not_attached')).toBe('The engine is not ready yet — try again in a moment.');
  });

  it('names browser storage, and says the engine was never asked, when the registry write failed first', () => {
    const sentence = describeNewSceneRefusal('registry_not_cleared');
    expect(sentence).toBe(
      'A new scene could not be started because the browser refused to update its local storage (the prefab-instance registry), so the engine was never asked.',
    );
    expect(sentence).not.toContain('did not accept');
  });

  it('reads a missing reason as the engine refusing, which is what every pre-existing test double means by false', () => {
    expect(describeNewSceneRefusal(null)).toBe(describeNewSceneRefusal('engine_refused'));
  });

  it('ends every clause with a full stop, so callers can append their next step', () => {
    const reasons: Array<NewSceneRefusal | null> = ['engine_refused', 'engine_not_attached', 'registry_not_cleared', null];
    for (const reason of reasons) expect(describeNewSceneRefusal(reason)).toMatch(/\.$/);
  });
});
