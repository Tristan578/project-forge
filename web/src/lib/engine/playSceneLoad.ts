/**
 * Scene loading for the public `/play` surface.
 *
 * `GamePlayer` used to send `load_scene` with the scene as a JSON *string*,
 * straight after `init_engine`. Measured against a real engine build (#10196),
 * that call was refused twice over:
 *  - the engine's `load_scene` handler reads `payload.json`
 *    (`engine/src/core/commands/scene.rs`), and `handle_command` deserialises a
 *    JSON *string* payload as `Value::String`, which has no `json` field
 *    ("Missing 'json' field in load_scene payload");
 *  - the engine's command queue only exists after the Bevy app's first update,
 *    so a command sent straight after `init_engine` answers
 *    "PendingCommands resource not initialized" (about 1.3 s on the reference
 *    machine).
 * The response was never read, so every published game started on the engine's
 * default scene with nothing reporting a problem.
 *
 * This helper sends `{ json }`, retries ONLY the not-initialised refusal within
 * a bounded wait, and rejects with the engine's own error text for anything
 * else — a refused scene is the game's own fault and must be surfaced at once.
 *
 * Kept a leaf (no store, no hook imports): `/play` is the public,
 * unauthenticated bundle and must not pull in the editor's engine graph.
 */

import { PLAY_SCENE_LOAD_RETRY_MS, PLAY_SCENE_LOAD_TIMEOUT_MS } from '@/lib/config/timeouts';

/** The engine's answer to a command, as `handle_command` returns it. */
export interface EngineCommandResponse {
  success: boolean;
  error?: string;
}

/** The engine's command entry point, as `/play` sees it. */
export type EngineCommandSink = (command: string, payload: unknown) => unknown;

/**
 * Read a refusal out of a `handle_command` return value.
 *
 * Only an explicit `success: false` is a refusal — the same contract the
 * editor's `sceneSlice` applies to its dispatcher: every test double returns
 * nothing, and the engine itself always answers with an object.
 * @param response Whatever `handle_command` returned.
 * @returns The engine's error text when the command was refused, else `null`.
 */
export function refusalOf(response: unknown): string | null {
  if (typeof response !== 'object' || response === null) return null;
  const r = response as Partial<EngineCommandResponse>;
  if (r.success !== false) return null;
  return typeof r.error === 'string' && r.error.length > 0 ? r.error : 'no reason given';
}

/** The one refusal that means "ask again", not "the scene is bad". */
const NOT_INITIALIZED = /not initialized/;

export interface LoadSceneOptions {
  /** Longest to wait for the engine to start accepting commands. */
  timeoutMs?: number;
  /** Poll interval while the engine initialises. */
  retryMs?: number;
  /**
   * Abort the wait. Checked before EVERY dispatch and it cuts the retry delay
   * short, so a `/play` that unmounts mid-boot stops sending `load_scene`
   * at once instead of for the rest of the ten-second window.
   */
  signal?: AbortSignal;
}

/** Thrown by {@link loadSceneWhenReady} when its `signal` aborts. */
export class SceneLoadCancelled extends Error {
  constructor() {
    super('Scene load cancelled');
    this.name = 'SceneLoadCancelled';
  }
}

/**
 * Hand a scene to the engine once it accepts commands.
 *
 * @param send The engine's `handle_command`.
 * @param sceneData The published game's scene, as stored (an object, not a string).
 * @param options Bounds on the wait for engine readiness.
 * @returns Resolves once the engine has queued the scene (it emits
 *   `SCENE_LOADED` when it has applied it); rejects with the engine's error text
 *   on any refusal other than "not initialized", or with a timeout message when
 *   the engine never becomes ready; rejects with {@link SceneLoadCancelled}
 *   once `signal` aborts, without another dispatch.
 * @throws Whatever `send` itself throws — a throwing dispatcher is a harder
 *   failure than a refusal and is not retried.
 */
export async function loadSceneWhenReady(
  send: EngineCommandSink,
  sceneData: unknown,
  { timeoutMs = PLAY_SCENE_LOAD_TIMEOUT_MS, retryMs = PLAY_SCENE_LOAD_RETRY_MS, signal }: LoadSceneOptions = {},
): Promise<void> {
  const json = JSON.stringify(sceneData);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) throw new SceneLoadCancelled();
    const refusal = refusalOf(send('load_scene', { json }));
    if (refusal === null) return;
    if (!NOT_INITIALIZED.test(refusal)) {
      throw new Error(`Scene failed to load: ${refusal}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Scene failed to load: the engine did not accept commands within ${timeoutMs}ms`);
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, retryMs);
      function onAbort() {
        clearTimeout(timer);
        resolve();
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
