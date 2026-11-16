/**
 * Why `loadScene()` answered `false`, and the words for it.
 *
 * Four callers load over a scene that is still intact and pass
 * `rejectionStrandsEditor: false`: the auto-save restore banner, the Scene
 * toolbar's import, and the `load_scene` and `switch_scene` chat tools. That
 * option keeps saving enabled, which is right, but it also means no
 * `sceneLoadError` is set. So the engine's reason, which since #10267 names
 * the field the scene failed on, never reached the person. Each caller showed
 * a guess instead ("its data may be invalid or the engine is not ready"),
 * which covers three different facts.
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
 * The cause, for the person, ending in a full stop. Callers put their own lead
 * in front ("The saved scene could not be restored.") and their own next step
 * after it.
 *
 * `null` means no refusal was recorded beside the `false`. In production the
 * only such case is that no engine was attached yet (the load was not
 * attempted), so it reads as "not ready".
 * @param refusal What `sceneLoadRefusal()` returned right after the `false`.
 * @returns One or two sentences naming the cause.
 */
export function describeSceneLoadRefusal(refusal: SceneLoadRefusal | null): string {
  if (refusal === null) return 'The engine is not ready yet — try again in a moment.';
  switch (refusal.kind) {
    case 'prefab_invalid':
      return 'Its prefab data is invalid or its prefab references form a cycle.';
    case 'engine_refused':
      return refusal.details
        ? `The engine refused to load it. Details: ${refusal.details}`
        : 'The engine refused to load it and gave no further detail.';
  }
}
