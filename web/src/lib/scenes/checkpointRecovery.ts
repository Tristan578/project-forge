/**
 * Checkpoint engine handshakes. A queued load is not a completed restore:
 * wait for SCENE_LOADED, then read the scene back using a correlated export.
 */
import { newSceneExportRequestId, SCENE_EXPORTED_EVENT, type SceneExportedDetail } from '@/lib/engine/sceneExportWire';
import type { SceneFileData } from './sceneManager';
import { describeSceneRefusal, validateSceneFile } from './sceneValidation';

/** Emitted after the engine applies a scene and the editor adopts its metadata. */
export const SCENE_LOADED_EVENT = 'forge:scene-loaded';
/** Exports with this prefix are reads for recovery, never autosave requests. */
export const CHECKPOINT_EXPORT_PREFIX = 'checkpoint-';

type ExportRequest = (requestId: string) => boolean;

/** The next step every checkpoint-validation failure ends with. */
const CHECKPOINT_NEXT_STEP = 'Reload the editor and try again.';

/**
 * The error a person reads when the scene the engine handed back for a
 * checkpoint fails validation.
 *
 * @param reason The refusal text, or `null` when there is none: no decoder
 *   was attached, the decoder threw, or the engine refused without saying why.
 * @returns A plain sentence naming the failure, followed by the next step.
 */
export function checkpointValidationMessage(reason: string | null): string {
  return reason
    ? `The engine returned a scene that failed validation. ${describeSceneRefusal(reason)} ${CHECKPOINT_NEXT_STEP}`
    : `The engine returned an invalid scene, or scene validation is unavailable. ${CHECKPOINT_NEXT_STEP}`;
}

/** Read exactly this request's response; legacy uncorrelated replies are unsafe.
 *
 * @param requestExport Sends a correlated export; true means accepted, not completed.
 * @param timeoutMs Export timeout in milliseconds; defaults to 5000.
 * @returns The validated scene from the matching export event.
 * @throws If unavailable, rejected, invalid, or not confirmed before the timeout.
 */
export function captureCheckpointScene(requestExport: ExportRequest, timeoutMs = 5000): Promise<SceneFileData> {
  if (typeof window === 'undefined') return Promise.reject(new Error('The engine is not available.'));
  const requestId = CHECKPOINT_EXPORT_PREFIX + newSceneExportRequestId();
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, data?: SceneFileData) => {
      clearTimeout(timer);
      window.removeEventListener(SCENE_EXPORTED_EVENT, onExport);
      if (error) reject(error);
      else resolve(data!);
    };
    const onExport = (event: Event) => {
      const detail = (event as CustomEvent<SceneExportedDetail>).detail;
      if (detail?.requestId !== requestId) return;
      try {
        const data: unknown = JSON.parse(detail.json);
        // This is where #10267's bug class surfaces first — the engine wrote a
        // scene its own decoder then refuses — so the reason must reach the
        // person (in plain words, see `describeSceneRefusal`), with a next step.
        const verdict = validateSceneFile(data);
        if (!verdict.valid) throw new Error(checkpointValidationMessage(verdict.reason));
        finish(undefined, data as SceneFileData);
      } catch (error) {
        finish(error instanceof Error ? error : new Error('The scene could not be read.'));
      }
    };
    const timer = setTimeout(() => finish(new Error('The engine did not confirm the scene export. Try again after it finishes loading.')), timeoutMs);
    window.addEventListener(SCENE_EXPORTED_EVENT, onExport);
    try {
      if (!requestExport(requestId)) finish(new Error('The engine is not ready. Wait for it to load, then try again.'));
    } catch (error) {
      finish(error instanceof Error ? error : new Error('The scene export failed.'));
    }
  });
}

// Export ordering is not significant. Compare all supplied scene fields while
// accepting fields the engine fills from serde defaults (including empty scenes).
function matchesExpected(expected: unknown, actual: unknown, path = ''): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) return false;
    const sorted = (values: unknown[]) => [...values].sort((a, b) => {
      const id = (value: unknown) => value && typeof value === 'object' ? String((value as Record<string, unknown>).entityId ?? '') : '';
      return id(a).localeCompare(id(b));
    });
    const actualItems = sorted(actual);
    return sorted(expected).every((value, index) => matchesExpected(value, actualItems[index], `${path}[]`));
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([key, value]) => {
      const field = path ? `${path}.${key}` : key;
      // `prefabInstances`/`prefabDefinitions` are editor-side metadata that live
      // in the prefab store, not the ECS — the engine ignores them on load and
      // never echoes them on export, so a checkpoint scene that carries them
      // (scene.FR-1 N1) would otherwise fail this engine-application check every
      // time. Their round trip is verified separately by the registry install in
      // `restoreCheckpoint`; this comparison is only about what the ENGINE applied.
      // `completionMode` (#9998) is the same kind of key: frontend-only, never
      // echoed, and carried to the store by the SCENE_LOADED handoff instead.
      return ['metadata.createdAt', 'metadata.modifiedAt', 'sceneName', 'formatVersion', 'prefabInstances', 'prefabDefinitions', 'completionMode'].includes(field) ||
        matchesExpected(value, (actual as Record<string, unknown>)[key], field);
    });
  }
  if (typeof expected === 'number' && typeof actual === 'number') {
    return Math.fround(expected) === Math.fround(actual);
  }
  return expected === actual;
}

/** Load a validated scene and verify the engine's resulting serialized state.
 *
 * @param scene Validated scene payload to apply; storage is not changed here.
 * @param load Dispatches JSON and returns whether the engine accepted the request.
 * @param requestExport Sends the correlated export used to verify applied state.
 * @param isCurrent Returns false if a different project or scene operation superseded this one.
 * @param timeoutMs Scene-loaded wait in milliseconds; defaults to 10000. Readback has its own 5000 ms timeout.
 * @returns Resolves after the load event and matching validated readback agree with the supplied scene.
 * @throws On dispatch rejection, timeout, supersession, or mismatched readback; callers own rollback.
 */
export async function applyCheckpointScene(
  scene: SceneFileData,
  load: (json: string) => boolean,
  requestExport: ExportRequest,
  isCurrent: () => boolean,
  timeoutMs = 10000,
): Promise<void> {
  if (typeof window === 'undefined') throw new Error('The engine is not available.');
  let abandon: () => void = () => {};
  const loaded = new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      window.removeEventListener(SCENE_LOADED_EVENT, onLoaded);
      if (error) reject(error); else resolve();
    };
    const onLoaded = () => finish();
    const timer = setTimeout(() => finish(new Error('The engine did not apply the checkpoint.')), timeoutMs);
    abandon = () => finish(new Error('The engine refused the checkpoint.'));
    window.addEventListener(SCENE_LOADED_EVENT, onLoaded);
  });
  try {
    if (!isCurrent() || !load(JSON.stringify(scene))) abandon();
  } catch {
    abandon();
  }
  await loaded;
  if (!isCurrent()) throw new Error('The project changed while restoring. Try again in the intended project.');
  const applied = await captureCheckpointScene(requestExport);
  if (!isCurrent()) throw new Error('The project changed while restoring. Try again in the intended project.');
  if (!matchesExpected(scene, applied)) throw new Error('The engine applied different scene data; the checkpoint was not saved.');
}
