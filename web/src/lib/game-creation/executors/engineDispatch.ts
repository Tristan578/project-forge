import { z } from 'zod';
import type { ExecutorContext } from '../types';

/**
 * Dispatch helpers shared by every executor that talks to the engine.
 *
 * These three lived as private copies inside `worldBuildExecutor` and
 * `entitySetupExecutor`. Each carries a non-obvious engine invariant in its
 * comment, and a copied invariant is an invariant that gets fixed in one place.
 */

/**
 * Mirrors the engine's `is_valid_override_id` (core/entity_factory.rs):
 *
 *     !id.is_empty() && id.len() <= 64 && !id.chars().any(|c| c.is_control())
 *
 * An id the engine rejects is not an error there — it silently falls back to a
 * random UUID, which is exactly the invisible failure a planned id exists to
 * prevent: every later command in the plan names an entity that does not exist.
 * A dispatch response cannot catch this — the engine did not refuse the command,
 * it accepted it and renamed the entity, so `success` is honestly `true`. Reject
 * it here instead, where a step can say so.
 *
 * THE CHECK RUNS ON THE RAW STRING, NOT A TRIMMED COPY. It used to trim first,
 * and that made this validator disagree with the engine in the one direction
 * that matters — accepting ids the engine refuses. `"\tabc"` trims to a clean
 * `abc` here while Rust's `is_control` sees the tab and refuses the whole id;
 * 64 characters plus a trailing space is 65 bytes to the engine and 64 to a
 * trimmed count. Both cases produced a step that reported success against an
 * entity the engine had quietly renamed.
 *
 * The one place it is deliberately STRICTER than the engine is a whitespace-only
 * id, which Rust accepts (a space is not a control character). That is a loud
 * refusal rather than a silent divergence, and the safe direction to err in.
 */
export const engineEntityId = z.string().refine((raw) => {
  const hasControlChar = [...raw].some((c) => {
    const code = c.codePointAt(0)!;
    // C0, DEL, and C1 — the same set as Rust's `char::is_control` (Unicode Cc),
    // not just the ASCII half of it.
    return code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
  });
  return raw.trim().length > 0
    && !hasControlChar
    && new TextEncoder().encode(raw).length <= 64;
}, 'entityId must be 1-64 bytes as the engine counts them, with no control '
  + 'characters and at least one non-whitespace character');

export interface EngineCommand {
  command: string;
  payload: unknown;
}

/**
 * Yield until the engine has stepped at least one frame.
 *
 * This is load-bearing, not defensive. Bevy `Commands` are deferred to the
 * schedule's next sync point, and Bevy inserts an `ApplyDeferred` only at an
 * EXPLICIT ordering edge. Two bridge systems that both mutate the same entity
 * with no `.chain()` between them therefore cannot see each other's inserts
 * within one frame, in either execution order. Two concrete cases are in play:
 *
 *  - `apply_spawn_requests` (core/entity_factory.rs) creates entities through
 *    `Commands`, while `apply_pending_transforms` (bridge/core_systems.rs)
 *    resolves its queue against `Query<(&EntityId, &mut Transform)>` and
 *    `drain(..)`s it — an update matching no entity is dropped and never
 *    retried.
 *  - `apply_physics_toggles` inserts `PhysicsEnabled` + `PhysicsData::default()`
 *    through `Commands`, while `apply_physics_updates` merges its patch onto an
 *    EXISTING `PhysicsData` and drops the patch with a `tracing::warn!` when
 *    there is none. The 3D pair is registered updates-first and unchained
 *    (bridge/mod.rs), so a toggle and its patch in the same frame lose the
 *    patch.
 *
 * Neither case reports anything JS-side, and a dispatch response cannot rescue
 * either one: both commands were accepted and answered `success` — the loss
 * happens a frame later, inside a system that has no way back to the caller.
 *
 * Two `requestAnimationFrame` ticks rather than one: the engine drives its own
 * loop, so a single tick can land inside the same engine frame that queued the
 * first command. Under Node (unit tests, or any non-browser caller) there is no
 * rAF and a macrotask hop is the honest equivalent — nothing is racing there.
 */
export function waitForEngineFrame(): Promise<void> {
  const raf =
    typeof globalThis.requestAnimationFrame === 'function'
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : null;

  if (!raf) {
    return new Promise((resolve) => { setTimeout(resolve, 0); });
  }
  return new Promise((resolve) => { raf(() => { raf(() => { resolve(); }); }); });
}

/**
 * Send a batch of commands, preferring the batch dispatcher when the caller
 * supplied one.
 *
 * Returns whether the engine accepted them ALL. Both paths report now:
 * `dispatchCommandBatch` answers with a `BatchResult`, and `dispatchCommand`
 * answers with a `CommandResponse` — which it always did, but `ExecutorContext`
 * used to type away as `void`, so this function had no choice but to return
 * `true` unconditionally whenever the context carried no batch dispatcher
 * (PF-1231). That is not a hypothetical branch: `orchestratorSlice` fills the
 * field from `getCommandBatchDispatcher() ?? undefined`, and a WASM build
 * without `handle_command_batch` leaves it unset, so the whole pipeline runs on
 * the single path.
 *
 * The loop does NOT stop at the first rejection. Every command here belongs to
 * one step's worth of work, the batch path has no early exit either (the engine
 * runs the whole envelope and returns a result per command), and a caller that
 * saw half a step applied on one path and a different half on the other would
 * have to know which dispatcher it got. A dispatcher returning nothing counts
 * as acceptance — see the note on `ExecutorContext.dispatchCommand`.
 */
export function sendCommands(ctx: ExecutorContext, commands: EngineCommand[]): boolean {
  if (commands.length === 0) return true;
  if (ctx.dispatchCommandBatch) {
    return ctx.dispatchCommandBatch(commands).success;
  }
  let accepted = true;
  for (let i = 0; i < commands.length; i += 1) {
    const response = ctx.dispatchCommand(commands[i].command, commands[i].payload);
    if (response && response.success === false) accepted = false;
  }
  return accepted;
}
