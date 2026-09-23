/**
 * Persisting a scene's completion mode (idea.FR-1.OP-04, #9998).
 *
 * WHERE IT LIVES. The mode is frontend-only: the engine's `SceneGraphData`
 * never carries it, and its `SceneFile` knows nothing about it. It is stored as
 * one extra top-level key, `completionMode`, of the scene file. The engine's
 * `SceneFile` struct has no `deny_unknown_fields`
 * (`engine/src/core/scene_file.rs`), so the key rides through `load_scene`
 * untouched — the same route `prefabInstances`/`prefabDefinitions` (scene.FR-1
 * N1) and the music arrangement (#10058) already take.
 *
 * WHY NOT A `formatVersion` BUMP. Both readers refuse anything outside 1..=3
 * (`parse_scene_file` in Rust, `readSceneFile`/`isSceneFileEnvelope` here), and
 * the engine writes `format_version` itself on export. A version 4 would be
 * rejected by every engine binary already deployed until a Rust change, a WASM
 * rebuild and a deploy shipped together — for a key the engine never reads.
 * An optional key needs no version: its absence IS the legacy case.
 *
 * MIGRATION RULE (documented in `docs/features/save-load.md`). No key means
 * `win`, at any `formatVersion`: the file reads back as `undefined`, which
 * `validateWinnability` treats exactly as `win`. A legacy file re-saves without
 * gaining the key, so nothing is added and nothing is dropped. A value that is
 * not one of the four modes reads as absent — the strict `win` gate — and logs
 * a warning rather than disappearing silently. The mode is never inferred from
 * entity names.
 *
 * THE TWO CHOKE POINTS. Writing: the `SCENE_EXPORTED` handler folds the live
 * mode into every export (the `.forge` download, autosave, the IndexedDB cache,
 * the panic backup, the cloud PUT and scene-switch captures all read that one
 * JSON). Reading: `dispatchSceneLoad`/`newScene`/`loadTemplate` stage the
 * incoming scene's mode here and the `SCENE_LOADED` handler takes it — the
 * handler is the scene boundary that clears the outgoing scene's mode, so the
 * incoming one has to arrive through it rather than be written before it.
 *
 * Every read treats its input as untrusted: a `.forge` file can come from
 * anyone's disk, and project `sceneData` can be a stranger's remixed project.
 */

import { validateCompletionMode, type CompletionMode } from '@/lib/playMode/completionMode';

/** The top-level scene-file key the mode is stored under. */
export const COMPLETION_MODE_SCENE_KEY = 'completionMode';

/**
 * Read the mode out of parsed, untrusted scene data.
 * @param sceneData A parsed scene file or project `sceneData` object.
 * @returns The mode, or `undefined` for a legacy file (treated as `win`) or an
 *   unreadable value (also treated as `win`, with a warning).
 */
export function readCompletionModeFromSceneData(sceneData: unknown): CompletionMode | undefined {
  if (typeof sceneData !== 'object' || sceneData === null || Array.isArray(sceneData)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(sceneData, COMPLETION_MODE_SCENE_KEY)) return undefined;
  const raw = (sceneData as Record<string, unknown>)[COMPLETION_MODE_SCENE_KEY];
  if (raw === undefined) return undefined;
  const validation = validateCompletionMode(raw);
  if (validation.ok) return validation.mode;
  console.warn(`[Scenes] ${validation.error} The scene opens in win mode.`);
  return undefined;
}

/**
 * Read the mode out of a serialized scene. Never throws: a scene this cannot
 * parse is one the engine will refuse anyway, and a throw here would abort the
 * load before it dispatched.
 * @param json Serialized scene JSON, potentially untrusted.
 * @returns The mode, or `undefined` (legacy `win`).
 */
export function readCompletionModeFromSceneJson(json: string): CompletionMode | undefined {
  try {
    return readCompletionModeFromSceneData(JSON.parse(json));
  } catch {
    return undefined;
  }
}

/**
 * Copy of a scene object with its mode set, or removed for `undefined`.
 * @param scene Scene file data.
 * @param mode The mode to record; `undefined` keeps the scene legacy.
 * @returns A new object; `scene` is not mutated.
 */
export function withCompletionMode<T extends object>(
  scene: T,
  mode: CompletionMode | undefined,
): T & { completionMode?: CompletionMode } {
  const next = { ...scene } as Record<string, unknown>;
  if (mode === undefined) delete next[COMPLETION_MODE_SCENE_KEY];
  else next[COMPLETION_MODE_SCENE_KEY] = mode;
  return next as T & { completionMode?: CompletionMode };
}

/**
 * Fold the live mode into an exported scene JSON.
 *
 * A scene whose mode was never chosen comes back byte-identical, so a legacy
 * project re-saves exactly as before. Unparseable input passes through: an
 * export must not be blocked by a fold that could not run (the same fail-soft
 * posture as `foldExportedSceneJson`).
 * @param json Scene JSON as the engine exported it (after the prefab fold).
 * @param mode The live `sceneGraph.completionMode`.
 * @returns The JSON with `completionMode` set when there is one to record.
 */
export function foldCompletionModeIntoSceneJson(json: string, mode: CompletionMode | undefined): string {
  if (mode === undefined) return json;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return json;
    return JSON.stringify(withCompletionMode(parsed, mode));
  } catch {
    return json;
  }
}

// ---------------------------------------------------------------------------
// Staging: carried from the load request across to SCENE_LOADED.
// ---------------------------------------------------------------------------

/**
 * Boxed so a rollback can tell ITS staging apart from a later one that happens
 * to hold the same mode — identity, not value, is what "still mine" means.
 */
let staged: { mode: CompletionMode | undefined } = { mode: undefined };

function replaceStaged(mode: CompletionMode | undefined): () => void {
  const previous = staged;
  const mine = { mode };
  staged = mine;
  return () => {
    if (staged === mine) staged = previous;
  };
}

/**
 * Hold the incoming scene's mode until the engine confirms the load.
 * @param mode The mode the incoming scene should open with.
 * @returns A rollback for a rejected dispatch; a no-op once this staging has
 *   been taken or replaced.
 */
export function stageSceneCompletionMode(mode: CompletionMode | undefined): () => void {
  return replaceStaged(mode);
}

/** Claim the staged mode for `SCENE_LOADED`, leaving nothing behind. */
export function takeStagedSceneCompletionMode(): CompletionMode | undefined {
  const { mode } = staged;
  staged = { mode: undefined };
  return mode;
}

/**
 * Drop anything staged — for `new_scene`, which emits the same `SCENE_LOADED`
 * a load does, so a stash left by a load the engine rejected would otherwise be
 * adopted by the empty scene.
 * @returns A rollback for a rejected new-scene dispatch.
 */
export function clearStagedSceneCompletionMode(): () => void {
  return replaceStaged(undefined);
}
