import { z } from 'zod';
import type { ExecutorContext, EngineEffectResult, ObservedEntity } from '../types';
import {
  ENGINE_EFFECT_OBSERVATION_DEADLINE_MS,
  ENGINE_EFFECT_POLL_INTERVAL_MS,
} from '@/lib/config/timeouts';

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

/**
 * The operation family this slice confirms (#9899). Recorded on every
 * `EngineEffectResult` and used as the default operation id so a caller that
 * does not mint its own still produces a correlatable, traceable result.
 */
export const SPAWN_TRANSFORM_OPERATION = 'ai.FR-1.OP-01';

/** A `rejected` result for a command the dispatcher refused outright. */
export function rejectedEffect(operationId: string, entityId: string): EngineEffectResult {
  return { status: 'rejected', operationId, entityId };
}

/**
 * Tolerance for confirming an observed transform vector equals the requested one
 * (#9899). The engine stores transforms as f32 and the query round-trips them
 * back through JSON, so a value that WAS applied comes back rounded — an exact
 * `===` would reject a correctly-applied transform and report `timed-out`
 * against the very effect it was meant to confirm.
 *
 * Both an absolute floor (a near-zero axis has no meaningful relative term) and
 * a relative term (`update_transform` scale runs up to 1000, where f32 spacing
 * is coarser than any fixed epsilon), so a single ratio holds across the whole
 * validated range.
 */
export const OBSERVED_VEC3_TOLERANCE = 1e-3;

/**
 * A `satisfied` building block: true when an observed [x, y, z] equals `expected`
 * within `OBSERVED_VEC3_TOLERANCE` on every axis. A missing or malformed vector
 * (the engine has not answered yet, or answered without a transform) is NOT a
 * match — the caller keeps polling until the real value lands, which is exactly
 * the transform half of the #9899 contract: acceptance is not application.
 */
export function observedVec3Matches(
  observed: readonly number[] | undefined,
  expected: readonly [number, number, number],
): boolean {
  if (!observed || observed.length < 3) return false;
  for (let i = 0; i < 3; i += 1) {
    const axis = observed[i];
    if (typeof axis !== 'number' || !Number.isFinite(axis)) return false;
    const tolerance = Math.max(OBSERVED_VEC3_TOLERANCE, Math.abs(expected[i]) * OBSERVED_VEC3_TOLERANCE);
    if (Math.abs(axis - expected[i]) > tolerance) return false;
  }
  return true;
}

/**
 * Confirm one deferred `update_transform` by reading the engine's REAL state
 * until the observed field (`position` or `scale`) reaches `expected` (#9899).
 *
 * This is the transform half of the same contract `entitySetupExecutor` uses for
 * spawn existence: an accepted `update_transform` dispatch reports only that the
 * engine TOOK the command — the deferred `apply_pending_transforms` runs a frame
 * later inside a system with no way back to the caller (see `waitForEngineFrame`
 * and PF-1213), and an update matching no entity is dropped and never retried.
 * So after acceptance the caller polls the engine's own state and reports
 * `applied` ONLY once it shows the requested value, never on acceptance plus a
 * frame wait.
 */
export function observeTransformEffect(options: {
  operationId?: string;
  entityId: string;
  field: 'position' | 'scale';
  expected: readonly [number, number, number];
  observe: (entityId: string) => ObservedEntity | undefined;
  signal: AbortSignal;
  deadlineMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<EngineEffectResult> {
  const { field, expected, ...rest } = options;
  return observeEngineEffect({
    ...rest,
    satisfied: (observed) => observedVec3Matches(observed.transform?.[field], expected),
  });
}

/**
 * Sleep for `ms`, resolving EARLY when `signal` aborts.
 *
 * Resolving early rather than rejecting keeps the caller's loop simple: it wakes
 * up, re-reads `signal.aborted` at the top, and returns `cancelled`. A rejection
 * would force a try/catch around every poll for a state the loop already checks.
 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export interface ObserveEngineEffectOptions {
  /** Correlation id echoed on the result; defaults to `SPAWN_TRANSFORM_OPERATION`. */
  operationId?: string;
  /** The entity whose real engine state proves (or disproves) the effect. */
  entityId: string;
  /**
   * Reads the engine's live view of `entityId`, or `undefined` while it is not
   * yet observable. Normally `ctx.observeEntity` — a call fires a fresh query
   * AND returns the latest cached answer.
   */
  observe: (entityId: string) => ObservedEntity | undefined;
  /**
   * True when an observation satisfies the INTENDED effect. For a spawn this is
   * simply "something was observed" (existence); for a transform it compares the
   * observed position/scale against the requested value. Defaults to existence.
   */
  satisfied?: (observed: ObservedEntity) => boolean;
  /** Cancellation token — an abort mid-observation yields `cancelled`. */
  signal: AbortSignal;
  /** Observation deadline; defaults to `ENGINE_EFFECT_OBSERVATION_DEADLINE_MS` (5 s). */
  deadlineMs?: number;
  /** Gap between polls; defaults to `ENGINE_EFFECT_POLL_INTERVAL_MS`. */
  pollIntervalMs?: number;
  /** Injectable clock (tests); defaults to `Date.now`. */
  now?: () => number;
  /** Injectable sleep (tests); defaults to an abort-aware `setTimeout`. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Observe the REAL engine until a deferred spawn/transform is confirmed, the
 * deadline expires, or the caller cancels — returning a typed, correlated
 * result (#9899).
 *
 * This is the contract the whole slice turns on: an accepted dispatch is NOT an
 * applied effect. `sendCommands` reports only that the engine took the command;
 * the deferred work runs a frame later inside a system with no way back to the
 * caller (see `waitForEngineFrame`). So after acceptance we query the engine's
 * own state and report `applied` ONLY once it shows the effect.
 *
 * The synchronous acceptance (`sendCommands`) is unaffected and stays the local
 * ack — this observation is the separate, up-to-5-second confirmation half, so
 * the ack latency NFR is met by returning acceptance immediately and confirming
 * asynchronously here.
 *
 * Correlation & cancellation (the "boundary and recovery" scenario): every
 * result carries its own `operationId`, and an aborted observation returns
 * `cancelled` and can NEVER return `applied`. A stale observation that resolves
 * after a retry therefore cannot be mistaken for the completion of the newer
 * operation — it resolves as its own `cancelled` result under its own id.
 */
export async function observeEngineEffect(
  options: ObserveEngineEffectOptions,
): Promise<EngineEffectResult> {
  const {
    entityId,
    observe,
    signal,
    operationId = SPAWN_TRANSFORM_OPERATION,
    satisfied = () => true,
    deadlineMs = ENGINE_EFFECT_OBSERVATION_DEADLINE_MS,
    pollIntervalMs = ENGINE_EFFECT_POLL_INTERVAL_MS,
    now = () => Date.now(),
    sleep = abortableSleep,
  } = options;

  const start = now();

  // `while (true)` with the abort check FIRST so a context aborted before the
  // first poll reports `cancelled`, never a spurious `applied`/`timed-out`.
  for (;;) {
    if (signal.aborted) {
      return { status: 'cancelled', operationId, entityId };
    }

    const observed = observe(entityId);
    if (observed && satisfied(observed)) {
      return { status: 'applied', operationId, entityId, observed };
    }

    // Deadline is checked AFTER a fresh observation, so an effect that lands
    // exactly at the deadline is still reported `applied` rather than lost.
    if (now() - start >= deadlineMs) {
      return { status: 'timed-out', operationId, entityId };
    }

    await sleep(pollIntervalMs, signal);
  }
}
