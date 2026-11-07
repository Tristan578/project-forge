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
 * ABSENCE IS A VALUE OF ITS OWN (documented in `docs/features/save-load.md`).
 * The engine's field is `Option<ProjectType>`: a file with no key — every
 * scene saved before the field existed, at any `formatVersion`, and any
 * producer that stated none — does NOT change the engine's type on load; the
 * engine keeps whatever the session is in and reports that. So a key-less
 * scene switched to inside a 2D project keeps 2D, and only a fresh engine,
 * which starts at 3D, opens it as 3D. The reader mirrors that with `null`,
 * never `'3d'`: reading absence as 3D is what flipped a 2D project to 3D on
 * every legacy load (review board round 1 on #10358). A value that is not
 * one of the two spellings also reads as `null`; the engine refuses the whole
 * scene for it (an unknown enum variant), so nothing downstream runs.
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
 * @returns `'2d'` or `'3d'` when the file states one; `null` when it does not —
 *   a legacy file with no key, an explicit `null`, anything that is not a
 *   scene object, or a spelling outside the vocabulary. `null` is the web
 *   mirror of the engine's `None`: the engine leaves its current type alone
 *   for such a scene, and a caller that needs a concrete type must decide
 *   what absence means for ITS path rather than have `'3d'` chosen here.
 */
export function readProjectTypeFromSceneData(sceneData: unknown): SceneProjectType | null {
  if (!isRecord(sceneData) || !isRecord(sceneData.metadata)) return null;
  const raw = sceneData.metadata[SCENE_PROJECT_TYPE_KEY];
  return isSceneProjectType(raw) ? raw : null;
}

/**
 * The dimension a fresh engine starts in, and so the one a scene that states
 * none comes up in when it is opened cold. Mirrors `ProjectType::default()`
 * in `engine/src/core/project_type.rs`.
 */
export const FRESH_ENGINE_PROJECT_TYPE: SceneProjectType = '3d';

/**
 * The scene a PROJECT-LEVEL open hands the engine (#10374).
 *
 * The engine is a page singleton (`init_engine` skips a second start, and
 * `useEngine` caches the module), so a client-side hop from `/editor/A` to
 * `/editor/B` keeps the SAME Bevy app and its `ProjectType`. A scene with no
 * key leaves that type alone on load, which is right when switching scenes
 * inside one project and wrong when opening a different project: a key-less
 * project opened after a 2D one inherited 2D, and its next autosave wrote
 * `projectType: "2d"` into it.
 *
 * Opening a project must mean what a cold open means, whatever the engine did
 * before, so a scene that states no type is opened as the fresh-engine type —
 * the dimension it already came up in on every cold open. A stated type, or a
 * value outside the vocabulary (the engine refuses that scene as before), is
 * left exactly as it is. Only the project open applies this: switching
 * scenes, restoring an auto-save or a checkpoint, and importing a file keep
 * the "inherit the session's type" rule (`docs/features/save-load.md`).
 *
 * @param sceneData The project's stored scene, parsed and untrusted.
 * @returns `sceneData` itself when it states a type or is not a scene object
 *   with a `metadata` record; otherwise a shallow copy whose
 *   `metadata.projectType` is {@link FRESH_ENGINE_PROJECT_TYPE}.
 */
export function sceneForProjectOpen(sceneData: unknown): unknown {
  if (!isRecord(sceneData) || !isRecord(sceneData.metadata)) return sceneData;
  const raw = sceneData.metadata[SCENE_PROJECT_TYPE_KEY];
  if (raw !== undefined && raw !== null) return sceneData;
  return {
    ...sceneData,
    metadata: { ...sceneData.metadata, [SCENE_PROJECT_TYPE_KEY]: FRESH_ENGINE_PROJECT_TYPE },
  };
}
