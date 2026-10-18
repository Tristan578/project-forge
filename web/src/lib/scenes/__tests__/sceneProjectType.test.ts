/**
 * @vitest-environment node
 *
 * Reading the project's dimension out of a scene file (#10227). The engine
 * writes it as `metadata.projectType` (`engine/src/core/scene_file.rs`) and
 * applies it on `load_scene` when present; this is the web side's read of the
 * same key, used where a page has to act on the type BEFORE the engine reports
 * it (`/play` sends `set_project_type` between `load_scene` and `play`).
 *
 * Absence is a value of its own. The engine's field is `Option<ProjectType>`
 * and a file with no key leaves the engine's current type alone, so the reader
 * answers `null` for it — never `'3d'`. Reading absence as 3D is what flipped a
 * 2D project to 3D on every legacy load (review board round 1 on #10358).
 */
import { describe, expect, it } from 'vitest';
import { readProjectTypeFromSceneData, SCENE_PROJECT_TYPE_KEY } from '../sceneProjectType';
import { sceneFixture } from './sceneFixture';

function withProjectType(projectType: unknown) {
  const scene = sceneFixture('S');
  return { ...scene, metadata: { ...scene.metadata, [SCENE_PROJECT_TYPE_KEY]: projectType } };
}

describe('readProjectTypeFromSceneData', () => {
  it('names the key the engine writes', () => {
    expect(SCENE_PROJECT_TYPE_KEY).toBe('projectType');
  });

  it.each(['2d', '3d'] as const)('reads %s', (projectType) => {
    expect(readProjectTypeFromSceneData(withProjectType(projectType))).toBe(projectType);
  });

  it('reads a legacy file with no key as absent (null), never as 3d', () => {
    const legacy = sceneFixture('Legacy');
    // Non-vacuous: the fixture must really lack the key.
    expect(Object.keys(legacy.metadata ?? {})).not.toContain(SCENE_PROJECT_TYPE_KEY);
    expect(readProjectTypeFromSceneData(legacy)).toBeNull();
  });

  it('reads an explicit null as absent, like the engine does', () => {
    expect(readProjectTypeFromSceneData(withProjectType(null))).toBeNull();
  });

  it('reads anything that is not a scene object as absent', () => {
    for (const notAScene of [undefined, null, 'json', 42, [], {}, { metadata: null }, { metadata: 'x' }]) {
      expect(readProjectTypeFromSceneData(notAScene)).toBeNull();
    }
  });

  it('reads a spelling outside the vocabulary as absent, never as 2d or 3d', () => {
    // The engine refuses the whole scene for these (serde enum), so nothing
    // downstream runs — but a reader that guessed "2d" from "2D" would send
    // `set_project_type` for a scene the engine is about to reject, and one
    // that guessed "3d" would have `/play` treat a refused scene as 3D.
    for (const bad of ['2D', '3D', 'TwoD', '', 2, true, {}]) {
      expect(readProjectTypeFromSceneData(withProjectType(bad))).toBeNull();
    }
  });
});
