/**
 * Why `loadScene()` answered `false`, and the words for it.
 *
 * Five callers load over a scene that is still intact and pass
 * `rejectionStrandsEditor: false`: the Scene Browser's switch
 * (`sceneSlice.switchScene`), the auto-save restore banner, the Scene
 * toolbar's import, and the `load_scene` and `switch_scene` chat tools. That
 * option keeps saving enabled, which is right, but it also means no
 * `sceneLoadError` is set. So the engine's reason, which since the #10267 fix
 * names the field the scene failed on, never reached the person, and each
 * caller showed a generic message instead.
 *
 * `sceneSlice.loadScene` records the refusal as it returns `false`, and
 * `sceneLoadRefusal()` reads it back synchronously, the way
 * `newSceneRefusal()` works for `newScene()`. It is a method rather than a
 * store field for the same reason: the chat tools hold a store SNAPSHOT
 * (`ctx.store`), on which a field written during the call would still read
 * its pre-call value.
 */

/** The reasons `loadScene()` answers `false` after it tried to load. */
export type SceneLoadRefusal =
  /**
   * The scene's embedded prefab data is invalid or its prefab references form
   * a cycle. The engine was never asked.
   */
  | { kind: 'prefab_invalid' }
  /**
   * The engine answered `{ success: false }`. `details` is its reason, already
   * bounded (`boundEngineError`) and worded for people (`describeSceneRefusal`),
   * or `null` when the engine gave none.
   */
  | { kind: 'engine_refused'; details: string | null };

/**
 * The cause, for the person, ending in sentence punctuation. Callers put their
 * own lead in front ("The saved scene could not be restored.") and their own
 * next step after it.
 *
 * `null` means no refusal was recorded beside the `false`, which happens only
 * when no engine was attached and the load was not attempted, so it reads as
 * "not ready". (`loadScene` resets the record on every call, so a `false`
 * read straight after the call can never see an older call's refusal.)
 * @param refusal What `sceneLoadRefusal()` returned right after the `false`.
 * @returns One or two sentences naming the cause.
 */
export function describeSceneLoadRefusal(refusal: SceneLoadRefusal | null): string {
  if (refusal === null) return 'The engine is not ready yet — try again in a moment.';
  switch (refusal.kind) {
    case 'prefab_invalid':
      return 'Its prefab data is invalid, or its prefabs reference each other in a loop.';
    case 'engine_refused':
      return refusal.details
        ? `The engine refused it: ${endSentence(refusal.details)}`
        : 'The engine refused it and gave no reason.';
  }
}

/**
 * Close the engine's reason as a sentence so the caller's next sentence does
 * not run on. A truncated reason ends in `… [truncated]`, which
 * `describeSceneRefusal` deliberately leaves without a full stop.
 */
function endSentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
