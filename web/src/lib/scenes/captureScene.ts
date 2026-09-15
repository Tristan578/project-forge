/**
 * Read the live scene back out of the engine.
 *
 * The engine owns the authoritative scene contents — the store mirrors only the
 * fragments the editor panels need — so the one way to obtain a whole scene is
 * the async round trip `export_scene` → `forge:scene-exported`. Anything that
 * has to PERSIST the current scene before moving off it (switching scenes,
 * duplicating the active one) must await that answer first, or it writes
 * whatever stale value the project file already held.
 *
 * `lib/export/exportEngine` performs the same handshake to build a downloadable
 * bundle; this is the multi-scene counterpart, kept separate because the two
 * disagree on what to do when the engine stays silent — an export has a user
 * waiting on a download and can fall back to the store, whereas a scene switch
 * must refuse rather than overwrite a saved scene with a guess.
 */
import type { SceneFileData } from './sceneManager';
import { writePrefabInstances } from './sceneManager';
import type { PrefabInstance } from '../prefabs/prefabInstance';

/** Window event the bridge emits in answer to an `export_scene` command. */
export const SCENE_EXPORTED_EVENT = 'forge:scene-exported';

/** Matches the export timeout in `lib/export/exportEngine`. */
export const SCENE_CAPTURE_TIMEOUT_MS = 5000;

export type SceneCapture =
  /** The engine answered — `data` is the scene as it stands right now. */
  | { status: 'captured'; data: SceneFileData }
  /**
   * No engine to ask (not loaded yet, or no browser). There is no live scene
   * that could be lost, so callers may proceed with the mutation.
   */
  | { status: 'unavailable' }
  /**
   * The request went out and the answer never arrived, or arrived unusable.
   * A live scene EXISTS and we could not read it — callers must abort rather
   * than persist a stale copy over it.
   */
  | { status: 'failed'; reason: string };

/**
 * Ask the engine for the active scene.
 *
 * @param requestExport Sends the `export_scene` command. Returns `false` when
 *   there is no engine to send it to, which is how this tells "nothing to
 *   capture" apart from "asked and got no answer".
 */
export function captureActiveScene(
  requestExport: () => boolean,
  timeoutMs: number = SCENE_CAPTURE_TIMEOUT_MS,
): Promise<SceneCapture> {
  if (typeof window === 'undefined') return Promise.resolve({ status: 'unavailable' });

  return new Promise((resolve) => {
    const settle = (result: SceneCapture) => {
      clearTimeout(timeoutId);
      window.removeEventListener(SCENE_EXPORTED_EVENT, handler);
      resolve(result);
    };

    const handler = (event: Event) => {
      const json = (event as CustomEvent<{ json?: unknown }>).detail?.json;
      if (typeof json !== 'string') {
        settle({ status: 'failed', reason: 'Scene export event carried no scene data.' });
        return;
      }
      try {
        settle({ status: 'captured', data: JSON.parse(json) as SceneFileData });
      } catch {
        settle({ status: 'failed', reason: 'Scene export returned data that could not be parsed.' });
      }
    };

    // Arm the timeout and subscribe BEFORE requesting. Nothing in the bridge
    // contract promises the answer arrives on a later tick, and a synchronous
    // one would otherwise land before anyone is listening and strand the
    // capture until it timed out. Arming first likewise means every exit path
    // clears the timer through `settle` — including a synchronous answer, which
    // would leave a timer running if the timer were armed afterwards.
    const timeoutId = setTimeout(() => {
      settle({
        status: 'failed',
        reason: `Engine did not answer the scene export request within ${timeoutMs}ms.`,
      });
    }, timeoutMs);

    window.addEventListener(SCENE_EXPORTED_EVENT, handler);

    if (!requestExport()) settle({ status: 'unavailable' });
  });
}

/**
 * Fold the current prefab-instance registry into a capture result before it is
 * persisted. The engine export does not know about linked instances (they live
 * in the prefab store, not the ECS), so persisting them with the scene has to
 * happen on the way out of capture — here — rather than inside the engine
 * round trip. Only a successful capture carries a scene to attach to; every
 * other status is returned untouched so the "abort rather than overwrite"
 * contract above is preserved (scene.FR-1 N1).
 */
export function attachPrefabInstances(
  capture: SceneCapture,
  instances: PrefabInstance[],
): SceneCapture {
  if (capture.status !== 'captured') return capture;
  return { status: 'captured', data: writePrefabInstances(capture.data, instances) };
}
