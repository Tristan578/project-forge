/**
 * The project's dimension in a scene file (#10227).
 *
 * WHERE IT LIVES. `metadata.projectType`, `"2d"` or `"3d"`, written by the
 * engine's `build_scene_file` from its `ProjectType` resource and queued back
 * into that resource by `load_scene` (`engine/src/core/scene_file.rs`,
 * `engine/src/bridge/scene_io.rs`). Unlike `completionMode` this key is the
 * ENGINE's: the 2D camera sprites render through exists only while the
 * resource says 2D, so the engine is its source of truth and reports every
 * change as `PROJECT_TYPE_CHANGED`, which `spriteEvents.ts` mirrors into
 * `spriteSlice.projectType`.
 *
 * WHY A WEB-SIDE READER AT ALL. Two places act on the type before the engine
 * has reported it: `/play` sends `set_project_type` between `load_scene` and
 * `play` so a refusal is a failed start rather than a blank canvas, and the
 * template translator writes the key from a template's category. Both read
 * or write the same key the engine does, through this module.
 *
 * MIGRATION RULE (documented in `docs/features/save-load.md`). No key means
 * 3D, at any `formatVersion` — the mode every scene saved before the field
 * existed was always opened in, and the engine's serde default. A value that
 * is not one of the two spellings reads as 3D here; the engine refuses the
 * whole scene for it (an unknown enum variant), so nothing downstream runs.
 *
 * Kept a leaf (no store, no hook imports): `/play` is the public,
 * unauthenticated bundle and must not pull in the editor's engine graph.
 */

/** The `metadata` key the engine writes. */
export const SCENE_PROJECT_TYPE_KEY = 'projectType';

/** The two spellings — the same vocabulary as the `set_project_type` command and the store. */
export type SceneProjectType = '2d' | '3d';

/**
 * Whether `value` is one of the two project-type spellings.
 * @param value Untrusted input: a scene key or an engine event field.
 * @returns True for exactly `'2d'` or `'3d'`.
 */
export function isSceneProjectType(value: unknown): value is SceneProjectType {
  return value === '2d' || value === '3d';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read the project type out of parsed, untrusted scene data.
 * @param sceneData A parsed scene file or project `sceneData` object.
 * @returns `'2d'` when the file says so; `'3d'` for a legacy file with no key,
 *   for anything that is not a scene object, and for any other value.
 */
export function readProjectTypeFromSceneData(sceneData: unknown): SceneProjectType {
  if (!isRecord(sceneData) || !isRecord(sceneData.metadata)) return '3d';
  const raw = sceneData.metadata[SCENE_PROJECT_TYPE_KEY];
  return isSceneProjectType(raw) ? raw : '3d';
}
