/**
 * A scene-replacing dispatch the ENGINE threw on, and the words the editor
 * uses for it.
 *
 * Two facts make this its own class rather than a plain `Error`:
 *
 * - A throw from the engine call is not a refusal. The bridge runs the
 *   command, which queues the `load_scene` / `new_scene`, and only then
 *   serializes its answer, so the throw can arrive after the engine has
 *   already begun replacing the scene. `sceneSlice` therefore locks every
 *   save path (`sceneLoadError` with the `ENGINE_LOAD_THREW` reason) before
 *   re-raising it (#10079, #10202).
 * - `loadScene` / `newScene` can also throw for reasons that have nothing to
 *   do with the engine — a `localStorage` write refused under quota, a
 *   subscriber that threw — and no lockout exists for those. A `catch` that
 *   told the user "saving is locked to protect your stored scene" for one of
 *   them would be stating three falsehoods and prescribing a pointless
 *   reload. So every surface that makes that claim narrows on this class
 *   with `instanceof`, and reports anything else as what it is: a failure
 *   with a message, and no lockout (#10202 review).
 *
 * Raised in one place — `sceneSlice`'s `dispatchSceneCommand` — for BOTH ways
 * a dispatcher can report a throw: by rethrowing it, and, as the one the
 * editor registers (`useEngineEvents`) does, by catching it and answering
 * `{ success: false, error, threw: true }`.
 */
export class EngineDispatchThrewError extends Error {
  /** The scene-replacing command whose engine call threw. */
  readonly command: string;

  /**
   * @param command The command that was dispatched: `'load_scene'` or `'new_scene'`.
   * @param message The engine's text, already bounded by the caller — it ends
   *   up in the lockout notice, a toast and the model's tool result.
   * @param options `cause`: the original throw, when the dispatcher rethrew one.
   */
  constructor(command: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EngineDispatchThrewError';
    this.command = command;
  }
}

/**
 * What the user does next after a dispatch the engine threw on. One sentence,
 * imported by every surface that shows it — the Scene Browser and toolbar
 * toasts, the template gallery, the auto-save recovery banner, the chat
 * tools and `loadTemplate` — so the wording cannot drift between them.
 */
export const ENGINE_THREW_RELOAD_GUIDANCE =
  'Reload the editor before continuing — the viewport can no longer be trusted, and saving is locked to protect your stored scene.';

/**
 * The full report for a dispatch the engine threw on: what failed, that the
 * engine failed and with what text (bounded upstream), then what to do.
 *
 * The parameter type is the narrowing: a `catch` cannot hand this an
 * arbitrary `unknown`, so the lockout claim is only ever made for the error
 * that carries one.
 * @param lead What failed, as a clause: `'The scene could not be opened'`.
 * @param error The re-raised engine throw.
 * @returns The sentence to show or return.
 */
export function engineThrewMessage(lead: string, error: EngineDispatchThrewError): string {
  return `${lead} due to an engine error (${error.message}). ${ENGINE_THREW_RELOAD_GUIDANCE}`;
}

/**
 * The report for a scene action that failed for a reason OTHER than the engine
 * throwing — a storage write refused, an unexpected JS error. No lockout was
 * set for it, so this says what happened and nothing about saving.
 * @param lead What failed, as a clause.
 * @param error Whatever was thrown.
 * @returns `lead: message`.
 */
export function sceneActionFailedMessage(lead: string, error: unknown): string {
  return `${lead}: ${thrownMessage(error)}`;
}

/**
 * The message of whatever was thrown. Read off any object that carries one
 * rather than only an `Error`: a `DOMException` — the shape of a refused
 * `localStorage` write, the most likely non-engine throw here — is not an
 * `Error` instance in every runtime (jsdom's is not), and `String()` of it
 * would prefix the name.
 */
function thrownMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return String(error);
}

/**
 * The one `catch` the UI surfaces share for a `loadScene` / `newScene` that
 * threw: the reload guidance when it was the engine, a plain failure
 * otherwise. Chat tools do not use this — they rethrow a non-engine error to
 * the executor's generic catch instead — so the `instanceof` here is the
 * narrowing for every toast and banner.
 * @param lead What failed, as a clause.
 * @param error Whatever `loadScene` / `newScene` threw.
 * @returns The sentence to show.
 */
export function sceneDispatchFailureMessage(lead: string, error: unknown): string {
  return error instanceof EngineDispatchThrewError
    ? engineThrewMessage(lead, error)
    : sceneActionFailedMessage(lead, error);
}
