/**
 * The words for each reason `loadScene()` answers `false`. Pinned
 * byte-for-byte: the Scene Browser switch, the auto-save restore, the toolbar
 * import and the `load_scene` / `switch_scene` tools all compose their
 * sentence from this clause, so a change here changes what five surfaces
 * tell the person.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  clearSceneLoadRefusal,
  describeSceneLoadRefusal,
  showSceneLoadRefusal,
  type SceneLoadRefusal,
} from '../sceneLoadRefusal';

vi.mock('@/lib/toast', () => ({
  showError: vi.fn(),
  showPersistentError: vi.fn(),
  dismissToast: vi.fn(),
}));

import { dismissToast, showError, showPersistentError } from '@/lib/toast';

describe('describeSceneLoadRefusal', () => {
  it('relays the engine reason it was given', () => {
    expect(describeSceneLoadRefusal({ kind: 'engine_refused', details: 'Missing field `entities`.' }))
      .toBe('The engine refused it: Missing field `entities`.');
  });

  it('says the engine gave no detail rather than inventing one', () => {
    expect(describeSceneLoadRefusal({ kind: 'engine_refused', details: null }))
      .toBe('The engine refused it and gave no reason.');
  });

  it('names the prefab data, not the engine, when the prefab data was refused', () => {
    const sentence = describeSceneLoadRefusal({ kind: 'prefab_invalid' });
    expect(sentence).toBe('Its prefab data is invalid, or its prefabs reference each other in a loop.');
    expect(sentence).not.toContain('engine');
  });

  it('reads a missing refusal as no engine attached yet', () => {
    expect(describeSceneLoadRefusal(null)).toBe('The engine is not ready yet — try again in a moment.');
  });

  it('closes a truncated engine reason with a full stop, so the next sentence does not run on', () => {
    expect(describeSceneLoadRefusal({ kind: 'engine_refused', details: 'Unknown variant `x…` … [truncated]' }))
      .toBe('The engine refused it: Unknown variant `x…` … [truncated].');
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

describe('showSceneLoadRefusal / clearSceneLoadRefusal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps a message with a recorded cause up until dismissed, under one id', () => {
    showSceneLoadRefusal('msg', { kind: 'prefab_invalid' });
    expect(vi.mocked(showPersistentError)).toHaveBeenCalledExactlyOnceWith('msg', { id: 'scene-load-refused' });
    expect(vi.mocked(showError)).not.toHaveBeenCalled();
  });

  it('uses an ordinary toast when no engine was attached, which fixes itself', () => {
    showSceneLoadRefusal('msg', null);
    expect(vi.mocked(showError)).toHaveBeenCalledExactlyOnceWith('msg');
    expect(vi.mocked(showPersistentError)).not.toHaveBeenCalled();
  });

  it('closes the refusal toast by the same id', () => {
    clearSceneLoadRefusal();
    expect(vi.mocked(dismissToast)).toHaveBeenCalledExactlyOnceWith('scene-load-refused');
  });
});
