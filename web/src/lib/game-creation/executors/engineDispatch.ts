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
 * Mirrors the engine's `is_valid_override_id` (core/entity_factory.rs): trimmed,
 * non-empty, at most 64 BYTES, no control characters. An id the engine rejects
 * is not an error there — it silently falls back to a random UUID, which is
 * exactly the invisible failure a planned id exists to prevent. Reject it here
 * instead, where a step can report it.
 */
export const engineEntityId = z.string().refine((raw) => {
  const id = raw.trim();
  const hasControlChar = [...id].some((c) => {
    const code = c.codePointAt(0)!;
    return code < 0x20 || code === 0x7f;
  });
  return id.length > 0
    && !hasControlChar
    && new TextEncoder().encode(id).length <= 64;
}, 'entityId must be 1-64 bytes with no control characters');

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
 * `dispatchCommand` returns void, so neither case reports anything JS-side.
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
 * Returns whether the engine accepted them. Single `dispatchCommand` returns
 * void, so on that path nothing can observe a rejection and `true` is the only
 * answer it can give — the batch path is the only one that can report.
 */
export function sendCommands(ctx: ExecutorContext, commands: EngineCommand[]): boolean {
  if (commands.length === 0) return true;
  if (ctx.dispatchCommandBatch) {
    return ctx.dispatchCommandBatch(commands).success;
  }
  for (let i = 0; i < commands.length; i += 1) {
    ctx.dispatchCommand(commands[i].command, commands[i].payload);
  }
  return true;
}
