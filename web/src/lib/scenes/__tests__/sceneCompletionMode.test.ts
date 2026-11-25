/**
 * @vitest-environment node
 *
 * The persisted half of completion modes (idea.FR-1.OP-04, #9998): how the
 * mode is written into a scene file, read back out of an untrusted one, and
 * carried from `load_scene` to `SCENE_LOADED`.
 *
 * The migration rule these tests pin (also in `docs/features/save-load.md`):
 * a file with no `completionMode` key is a `win` game, reads back as
 * `undefined`, and re-saves without gaining the key.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMPLETION_MODE_SCENE_KEY,
  clearStagedSceneCompletionMode,
  foldCompletionModeIntoSceneJson,
  readCompletionModeFromSceneData,
  readCompletionModeFromSceneJson,
  stageSceneCompletionMode,
  takeStagedSceneCompletionMode,
  withCompletionMode,
} from '../sceneCompletionMode';
import { sceneFixture } from './sceneFixture';

afterEach(() => {
  takeStagedSceneCompletionMode();
  vi.restoreAllMocks();
});

describe('readCompletionModeFromSceneData', () => {
  it.each(['win', 'endless', 'sandbox', 'narrative'] as const)('reads %s', (mode) => {
    expect(readCompletionModeFromSceneData({ ...sceneFixture('S'), completionMode: mode })).toBe(mode);
  });

  it('reads a legacy file with no key as undefined, which the validator treats as win', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readCompletionModeFromSceneData(sceneFixture('Legacy'))).toBeUndefined();
    // Absence is the normal legacy case, not something to warn about.
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads a value that is not a mode as absent — the strict win gate — and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readCompletionModeFromSceneData({ ...sceneFixture('S'), completionMode: 'Sandbox' })).toBeUndefined();
    expect(readCompletionModeFromSceneData({ ...sceneFixture('S'), completionMode: 7 })).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toContain('Unknown completion mode "Sandbox"');
  });

  it('never infers a mode from entity names', () => {
    const scene = { ...sceneFixture('S'), entities: [{ entityId: 'e', name: 'Sandbox Endless Narrative' }] };
    expect(readCompletionModeFromSceneData(scene)).toBeUndefined();
  });

  it.each([null, 'text', 42, ['sandbox']])('returns undefined for non-object scene data %p', (value) => {
    expect(readCompletionModeFromSceneData(value)).toBeUndefined();
  });

  it('parses JSON without throwing on garbage', () => {
    expect(readCompletionModeFromSceneJson(JSON.stringify({ ...sceneFixture('S'), completionMode: 'endless' }))).toBe('endless');
    expect(readCompletionModeFromSceneJson('{not json')).toBeUndefined();
  });
});

describe('foldCompletionModeIntoSceneJson', () => {
  it('adds the mode as the top-level completionMode key', () => {
    const raw = JSON.stringify(sceneFixture('S'));
    const folded = JSON.parse(foldCompletionModeIntoSceneJson(raw, 'sandbox')) as Record<string, unknown>;
    expect(COMPLETION_MODE_SCENE_KEY).toBe('completionMode');
    expect(folded.completionMode).toBe('sandbox');
    // Nothing else moved.
    expect({ ...folded, completionMode: undefined }).toEqual({ ...sceneFixture('S'), completionMode: undefined });
  });

  it('leaves a legacy scene byte-identical when no mode was ever chosen', () => {
    const raw = JSON.stringify(sceneFixture('Legacy'));
    expect(foldCompletionModeIntoSceneJson(raw, undefined)).toBe(raw);
  });

  it('round-trips every mode through fold and read', () => {
    for (const mode of ['win', 'endless', 'sandbox', 'narrative'] as const) {
      const folded = foldCompletionModeIntoSceneJson(JSON.stringify(sceneFixture('S')), mode);
      expect(readCompletionModeFromSceneJson(folded)).toBe(mode);
    }
  });

  it('passes unparseable JSON through rather than blocking the save', () => {
    expect(foldCompletionModeIntoSceneJson('{broken', 'sandbox')).toBe('{broken');
  });
});

describe('withCompletionMode', () => {
  it('sets the key on a copy and leaves the input alone', () => {
    const scene = sceneFixture('S');
    const next = withCompletionMode(scene, 'narrative');
    expect(next).toEqual({ ...scene, completionMode: 'narrative' });
    expect(scene).not.toHaveProperty('completionMode');
  });

  it('removes the key for undefined, so a legacy scene stays legacy', () => {
    const next = withCompletionMode({ ...sceneFixture('S'), completionMode: 'sandbox' }, undefined);
    expect(next).not.toHaveProperty('completionMode');
  });
});

describe('staging across load_scene -> SCENE_LOADED', () => {
  it('hands the staged mode to exactly one taker', () => {
    stageSceneCompletionMode('endless');
    expect(takeStagedSceneCompletionMode()).toBe('endless');
    expect(takeStagedSceneCompletionMode()).toBeUndefined();
  });

  it('replaces rather than accumulates', () => {
    stageSceneCompletionMode('endless');
    stageSceneCompletionMode('narrative');
    expect(takeStagedSceneCompletionMode()).toBe('narrative');
  });

  it('rolls a rejected staging back to what was staged before it', () => {
    stageSceneCompletionMode('endless');
    const rollback = stageSceneCompletionMode('sandbox');
    rollback();
    expect(takeStagedSceneCompletionMode()).toBe('endless');
  });

  it('does not let a stale rollback clobber a newer staging', () => {
    const rollback = stageSceneCompletionMode('sandbox');
    stageSceneCompletionMode('narrative');
    rollback();
    expect(takeStagedSceneCompletionMode()).toBe('narrative');
  });

  it('does not let a rollback resurrect a staging that was already taken', () => {
    const rollback = stageSceneCompletionMode('sandbox');
    takeStagedSceneCompletionMode();
    rollback();
    expect(takeStagedSceneCompletionMode()).toBeUndefined();
  });

  it('clears a stash left by a rejected load, with its own rollback', () => {
    stageSceneCompletionMode('sandbox');
    const rollback = clearStagedSceneCompletionMode();
    rollback();
    expect(takeStagedSceneCompletionMode()).toBe('sandbox');
    stageSceneCompletionMode('sandbox');
    clearStagedSceneCompletionMode();
    expect(takeStagedSceneCompletionMode()).toBeUndefined();
  });
});
