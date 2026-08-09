/**
 * Wire contract for the scene-export round trip (PF-1103).
 *
 * A caller dispatches `export_scene`, the engine serializes the scene one or
 * more frames later, and the bridge emits `SCENE_EXPORTED` — which
 * `transformEvents` re-broadcasts as the `forge:scene-exported` DOM event.
 * That event is a bare `window` broadcast, so before correlation existed
 * whichever listener happened to be subscribed consumed whatever landed,
 * regardless of who asked for it.
 *
 * The correlation token threads a caller-minted id through that trip:
 * `export_scene { requestId }` → `SCENE_EXPORTED { requestId }` → the DOM
 * event's `detail.requestId`. A listener keeps its own id and ignores answers
 * that are not its own.
 *
 * This module is the single place the accept rule lives, so the two listeners
 * (the export pipeline and the scene toolbar) cannot drift apart on the
 * back-compat case.
 */

/** DOM event name `transformEvents` broadcasts a completed scene export on. */
export const SCENE_EXPORTED_EVENT = 'forge:scene-exported';

/**
 * Byte bound the engine's `export_scene` validator enforces on `requestId`.
 *
 * Mirrors `MAX_EXPORT_REQUEST_ID_LEN` in `engine/src/core/commands/scene.rs`.
 * Exceeding it makes the engine reject the command outright, so an id minted
 * here must stay under it — a test pins that.
 */
export const MAX_SCENE_EXPORT_REQUEST_ID_LENGTH = 64;

/** Payload carried by the `forge:scene-exported` DOM event. */
export interface SceneExportedDetail {
  /** Serialized `.forge` scene JSON. */
  json: string;
  /** Scene name at export time. */
  name: string;
  /**
   * Correlation token echoed back from the `export_scene` payload.
   *
   * Absent when the caller did not supply one (the periodic autosave, the chat
   * tool) **and** when the running engine binary predates PF-1103 — the two are
   * indistinguishable on the wire, which is exactly why absence means "accept".
   */
  requestId?: string;
}

/**
 * Mint a correlation id for one `export_scene` request.
 *
 * `crypto.randomUUID` throws outside a secure context, and an export that
 * cannot mint an id must still export rather than throw on the way to the
 * engine — so the fallback is a best-effort unique string of the same shape
 * class (ASCII, well under the byte bound).
 */
export function newSceneExportRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Is this export event the answer to `expectedId`?
 *
 * An event with no id is accepted by ANY waiting listener. That is the
 * back-compat path: engine changes only reach users after a WASM rebuild ships
 * through CD, and until then every event arrives uncorrelated. Refusing those
 * would hang every export the moment this code deployed.
 *
 * An id that is present but different is someone else's answer and is refused —
 * including the empty string, which the engine rejects at dispatch and so can
 * never legitimately identify a request.
 */
export function isSceneExportResponseFor(
  expectedId: string,
  detail: SceneExportedDetail,
): boolean {
  const actual = detail.requestId;
  if (actual === undefined || actual === null) return true;
  return actual === expectedId;
}
