/**
 * Why `newScene()` answered `false`, and the words for each reason.
 *
 * The boolean folds three unrelated facts into one value, and every surface
 * that reports it used to attribute all three to the engine ("The engine did
 * not accept a new scene"). Two of them are not the engine's doing at all:
 * there may be no engine attached yet (the editor page renders before the
 * WASM module has loaded), or the browser may have refused the storage write
 * that clears the prefab-instance registry — which `sceneSlice.newScene`
 * does BEFORE dispatching, and treats as a refusal rather than a throw
 * because nothing was asked of the engine and the scene on screen is
 * unchanged (#10202 review). Telling the user their engine refused them in
 * either case sends them looking in the wrong place.
 *
 * `sceneSlice` records the reason as it returns `false`; `newSceneRefusal()`
 * reads it back, synchronously, the way `isEngineAttached()` already
 * disambiguated the no-engine case. A method rather than a store field
 * because the chat tools hold a SNAPSHOT of the store (`ctx.store`), on which
 * a field written during the call would still read its pre-call value.
 */

/** The reasons `newScene()` answers `false`. A throw is not one of them. */
export type NewSceneRefusal =
  /** No dispatcher yet: the engine mounts after the editor page. Retry in a moment. */
  | 'engine_not_attached'
  /** The engine answered `{ success: false }` — it kept the scene on screen. */
  | 'engine_refused'
  /**
   * `savePrefabInstancesToStorage([])` threw before the dispatch, so
   * `new_scene` was never sent. Browser storage, not the engine.
   */
  | 'registry_not_cleared';

/**
 * One sentence naming the cause, for the person. Callers append their own
 * next step ("The current scene is unchanged.", "Please try again.").
 *
 * `null` — no refusal recorded — reads as the engine case: in production
 * `newScene` records a reason on every `false`, so `null` beside a `false`
 * can only come from a test double, and the engine wording is the one every
 * pre-existing pin on those doubles expects.
 * @param refusal What `newSceneRefusal()` returned right after the `false`.
 * @returns The cause clause, ending in a full stop.
 */
export function describeNewSceneRefusal(refusal: NewSceneRefusal | null): string {
  switch (refusal) {
    case 'engine_not_attached':
      return 'The engine is not ready yet — try again in a moment.';
    case 'registry_not_cleared':
      return 'A new scene could not be started because the browser refused to update its local storage (the prefab-instance registry), so the engine was never asked.';
    case 'engine_refused':
    case null:
      return 'The engine did not accept a new scene.';
  }
}
