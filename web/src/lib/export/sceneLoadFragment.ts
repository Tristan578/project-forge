/**
 * Shared scene-load helper for exported games (single-HTML and ZIP).
 *
 * Found while instrumenting the exported runtime for #10013 and confirmed
 * against a real `webgpu,runtime` build: the exporters called
 * `handle_command('load_scene', JSON.stringify(scene))` immediately after
 * `init_engine`. That call was refused twice over:
 *  - the engine's `load_scene` handler reads `payload.json`
 *    (`engine/src/core/commands/scene.rs`), and a JSON *string* payload has no
 *    `json` field ("Missing 'json' field in load_scene payload");
 *  - the command queue only exists after the Bevy app's first update, so a
 *    command sent straight after `init_engine` returns "PendingCommands resource
 *    not initialized" (about 1.3 s on the reference machine).
 * The return value was never read, so an exported game started on the default
 * scene with nothing reporting a problem.
 *
 * This helper sends `{ json }` and retries only the not-initialised refusal,
 * within a bounded wait. Any other refusal is the scene's own fault and is
 * surfaced at once.
 */

/** Longest the loader waits for the engine to accept commands. */
export const SCENE_LOAD_TIMEOUT_MS = 30_000;

/** Poll interval while the engine initialises. */
export const SCENE_LOAD_RETRY_MS = 50;

/**
 * JS source defining `async function __forgeLoadScene(send, sceneData)`, where
 * `send` is the engine's `handle_command`. Resolves with the engine's
 * `{ success: true }` response; rejects with the engine's error text.
 * @param options Optional indentation prefix for each emitted line.
 * @returns Script source.
 */
export function generateSceneLoadFragment({ indent = '' }: { indent?: string } = {}): string {
  const body = `async function __forgeLoadScene(send, sceneData) {
  var sceneJson = JSON.stringify(sceneData);
  var deadline = performance.now() + ${SCENE_LOAD_TIMEOUT_MS};
  for (;;) {
    var res = send('load_scene', { json: sceneJson });
    if (res && res.success) return res;
    var err = res && res.error ? String(res.error) : 'no response from the engine';
    if (!/not initialized/.test(err) || performance.now() >= deadline) {
      throw new Error('Scene failed to load: ' + err);
    }
    await new Promise(function (resolve) { setTimeout(resolve, ${SCENE_LOAD_RETRY_MS}); });
  }
}`;
  if (!indent) return body;
  return body
    .split('\n')
    .map((line) => (line.length > 0 ? indent + line : line))
    .join('\n');
}
