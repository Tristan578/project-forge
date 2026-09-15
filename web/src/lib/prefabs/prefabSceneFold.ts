/**
 * The one fold that turns a raw engine scene export into a scene FILE.
 *
 * The engine serializes the ECS and nothing else, but a scene's linked prefab
 * instances (and the definitions they resolve through) live in the prefab
 * store, not the ECS (scene.FR-1 N1). Every consumer of a `SCENE_EXPORTED`
 * answer — autosave, the IndexedDB cache, the panic backup, the cloud PUT, the
 * scene-switch capture — therefore needs the same two fields grafted on, and
 * needs them grafted on BEFORE it sees the JSON.
 *
 * This lives in its own module rather than inside the `SCENE_EXPORTED` handler
 * so the handler is not the only thing that can perform it: a test standing in
 * for the engine bridge can call exactly what production calls instead of
 * restating it, which is the difference between a double that proves the
 * contract and one that pins whatever the test's author believed it was.
 */
import {
  loadPrefabInstances,
  takeStagedPrefabDataForExport,
  collectTransitivePrefabDefinitions,
  type PrefabExportSnapshot,
} from '@/lib/prefabs/prefabStore';
import { writePrefabInstances, writePrefabDefinitions, type SceneFileData } from '@/lib/scenes/sceneManager';

/**
 * Fold the prefab registry into an exported scene JSON, preferring the snapshot
 * staged for `requestId` over the live registry.
 *
 * The staged snapshot is the registry as it stood when this export was
 * REQUESTED, with its instances and their transitive definitions read in one
 * go. That pairing is the point: a save in flight while the user edits prefabs
 * or loads another scene must fold what was active when it was asked for, and
 * must never fold instances from one moment against definitions from another —
 * an instance whose definition is missing from the same file is dropped as
 * dangling on reopen. Callers that never staged one (autosave, the chat
 * `save_scene` tool, an engine binary too old to echo the id back) fall back to
 * a live read, which is at least internally consistent for the same reason.
 *
 * Consumes the staged entry: take-once, exactly as `takeStagedPrefabDataForExport`
 * defines it, so a second call for the same id falls back to the live registry.
 *
 * @param json Raw scene JSON as the engine serialized it.
 * @param requestId Correlation id from the export answer, if it carried one.
 * @returns The JSON with `prefabInstances`/`prefabDefinitions` folded in; the
 *   input untouched when there are no instances, or when it does not parse
 *   (fail-soft, matching `readPrefabInstances`' posture toward malformed data —
 *   an export must not be blocked by a fold that could not run).
 */
export function foldExportedSceneJson(json: string, requestId: string | undefined): string {
  const staged = takeStagedPrefabDataForExport(requestId);
  const instances = staged?.instances ?? loadPrefabInstances();
  if (instances.length === 0) return json;
  const snapshot: PrefabExportSnapshot = staged
    ?? { instances, definitions: collectTransitivePrefabDefinitions(instances) };
  try {
    const data = JSON.parse(json) as SceneFileData;
    return JSON.stringify(writePrefabDefinitions(writePrefabInstances(data, snapshot.instances), snapshot.definitions));
  } catch {
    return json;
  }
}
