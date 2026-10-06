/**
 * @vitest-environment node
 *
 * Reading the project's dimension out of a scene file (#10227). The engine
 * writes it as `metadata.projectType` (`engine/src/core/scene_file.rs`) and
 * restores it on `load_scene`; this is the web side's read of the same key,
 * used where a page has to act on the type BEFORE the engine reports it
 * (`/play` sends `set_project_type` between `load_scene` and `play`).
 *
 * Migration rule, same as the engine's serde default: no key means 3D, at
 * every formatVersion — that is the mode every scene saved before the field
 * existed was always opened in.
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

  it('reads a legacy file with no key as 3d', () => {
    const legacy = sceneFixture('Legacy');
    // Non-vacuous: the fixture must really lack the key.
    expect(Object.keys(legacy.metadata ?? {})).not.toContain(SCENE_PROJECT_TYPE_KEY);
    expect(readProjectTypeFromSceneData(legacy)).toBe('3d');
  });

  it('reads anything that is not a scene object as 3d', () => {
    for (const notAScene of [undefined, null, 'json', 42, [], {}, { metadata: null }, { metadata: 'x' }]) {
      expect(readProjectTypeFromSceneData(notAScene)).toBe('3d');
    }
  });

  it('reads a spelling outside the vocabulary as 3d, never as 2d', () => {
    // The engine refuses the whole scene for these (serde enum), so nothing
    // downstream runs — but a reader that guessed "2d" from "2D" would send
    // `set_project_type` for a scene the engine is about to reject.
    for (const bad of ['2D', '3D', 'TwoD', '', 2, null, true, {}]) {
      expect(readProjectTypeFromSceneData(withProjectType(bad))).toBe('3d');
    }
  });
});
