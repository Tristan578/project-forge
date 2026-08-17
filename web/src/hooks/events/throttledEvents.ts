/**
 * Events that carry high-frequency runtime data and can be throttled to 10fps
 * during play mode without meaningful loss of user-perceivable fidelity.
 *
 * Events NOT in this set (scene graph changes, selection, mode transitions,
 * collision events, script errors, history changes) are always processed
 * immediately.
 *
 * Every name here must be one the engine actually emits — verify against the
 * `emit_event` call sites, not against a handler switch. Those sites are spread
 * across the whole `engine/src` tree, not just `bridge/events.rs`
 * (`TRANSFORM_CHANGED` is emitted from `core/gizmo.rs` and `bridge/core_systems.rs`),
 * so a grep scoped to one file reports a real name as a phantom. A name nothing
 * emits is silently inert, and it fails in BOTH directions: the throttle budget
 * is spent on a phantom while the real high-frequency event goes unthrottled.
 * `PHYSICS2D_UPDATED` sat here doing exactly that until PF-1167; the emitted name
 * is `PHYSICS2D_CHANGED`. Pinned by `__tests__/throttledEvents.test.ts`.
 *
 * This lives in its own module rather than on `useEngineEvents` for two reasons:
 * the pin needs nothing but these six strings, and importing the hook to read
 * them drags in `editorStore`, all ten domain handlers, the selection batcher and
 * the play-mode throttle; and the `ReadonlySet` type keeps a consumer from
 * calling `.add()` and changing throttle behaviour with no dispatcher and no
 * coverage.
 */
export const THROTTLED_EVENTS: ReadonlySet<string> = new Set([
  'TRANSFORM_CHANGED',
  'ANIMATION_STATE_CHANGED',
  'ANIMATION_LIST_CHANGED',
  'PHYSICS_CHANGED',
  'DEBUG_PHYSICS_CHANGED',
  'PHYSICS2D_CHANGED',
]);
