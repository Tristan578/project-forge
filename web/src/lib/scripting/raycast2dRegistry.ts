/**
 * Correlates a dispatched `raycast2d` command with the engine's answer
 * (PF-1169 / #9271).
 *
 * THE CONSUMER IS THE USER SCRIPT, ON THE ASYNC CHANNEL PROTOCOL.
 * `forge.physics2d.raycast(...)` already round-trips through
 * `AsyncChannelRouter`'s `physics` channel, which correlates every request to
 * its own `requestId` and hands the answer back to the awaiting script. This
 * module is the missing last hop: the engine's reply arrives as a broadcast
 * event with no id on it, and something has to decide which in-flight request
 * it belongs to. Deliberately NOT a Zustand slice — a raycast answer has one
 * reader, the script that asked, and broadcasting it into the store would
 * re-render the editor per ray and reproduce the dead end one level on.
 *
 * WHY A FIFO, AND WHAT PINS IT
 * ----------------------------
 * The engine's payloads carry no correlation id:
 *
 *   emit_raycast2d_hit  -> { entityId, pointX, pointY, normalX, normalY, distance }
 *   emit_raycast2d_miss -> {}
 *
 * (both `#[serde(rename_all = "camelCase")]`, `engine/src/bridge/events.rs`).
 * What the engine does guarantee is ordering:
 * `apply_raycast2d_requests` (`engine/src/bridge/physics.rs`) drains
 * `pending.raycast2d_requests` in queue order, and EVERY branch of that loop —
 * no Rapier context, no hit, a hit on an entity with no `EntityId`, and the
 * real hit — emits exactly one event before moving to the next request. One
 * answer per accepted request, in order. So the Nth answer belongs to the Nth
 * accepted request and a FIFO is a complete correlation.
 *
 * That is a contract, not a coincidence, so it is stated here and asserted in
 * `__tests__/raycast2dRegistry.test.ts`. If the engine ever grows a
 * `requestId` on these payloads (the 3D `raycast_query` already has one), this
 * module is where it would replace the FIFO.
 *
 * ABANDONED REQUESTS ARE TOMBSTONED, NOT REMOVED
 * ----------------------------------------------
 * The `physics` channel times out at 1s and aborts. Dropping the aborted slot
 * would leave the engine owing an answer that then resolves the NEXT request —
 * every later answer off by one, which is precisely the "two overlapping
 * raycasts cross their answers" failure this exists to prevent. An abandoned
 * slot therefore stays in the queue as a settled tombstone and is consumed —
 * and discarded — when its own answer arrives.
 */

/** One 2D raycast hit, in the browser's own vocabulary. */
export interface Raycast2dHit {
  entityId: string;
  point: { x: number; y: number };
  normal: { x: number; y: number };
  distance: number;
}

interface PendingRaycast2d {
  settled: boolean;
  resolve: (answer: Raycast2dHit | null) => void;
  reject: (err: Error) => void;
  detach: () => void;
}

/**
 * Ceiling on outstanding requests. The channel already caps concurrency at 32,
 * but a dispatch that the engine never answers (an engine torn down mid-frame)
 * leaves a tombstone behind, and tombstones only clear when their answer
 * arrives. Without a ceiling a stalled engine grows this array without bound
 * for as long as play mode lasts.
 */
export const MAX_PENDING_RAYCASTS_2D = 256;

const queue: PendingRaycast2d[] = [];

/** How many slots — live or tombstoned — are still owed an answer. */
export function pendingRaycast2dCount(): number {
  return queue.length;
}

/**
 * Claim the next answer the engine will emit.
 *
 * Call this ONLY after the `raycast2d` command was accepted: an unaccepted
 * command produces no event, and a slot claimed for it would swallow the
 * answer belonging to the request after it.
 */
export function awaitRaycast2dAnswer(signal?: AbortSignal): Promise<Raycast2dHit | null> {
  if (signal?.aborted) {
    // Reject WITHOUT enqueuing: no command has been accepted on this path yet,
    // so no answer is owed and the queue must stay aligned.
    return Promise.reject(new Error('2D raycast aborted before it was dispatched'));
  }
  if (queue.length >= MAX_PENDING_RAYCASTS_2D) {
    return Promise.reject(
      new Error(
        `Too many 2D raycasts awaiting an answer (${MAX_PENDING_RAYCASTS_2D}); the engine is not replying`,
      ),
    );
  }

  return new Promise<Raycast2dHit | null>((resolve, reject) => {
    const entry: PendingRaycast2d = {
      settled: false,
      resolve,
      reject,
      detach: () => {},
    };

    if (signal) {
      const onAbort = () => {
        if (entry.settled) return;
        entry.settled = true;
        entry.detach();
        reject(new Error('2D raycast aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      entry.detach = () => signal.removeEventListener('abort', onAbort);
    }

    queue.push(entry);
  });
}

/**
 * Hand the engine's next answer to the oldest slot still owed one.
 *
 * Returns whether the answer was matched to a slot, which is what
 * `handlePhysicsEvent` reports to `useEngineEvents`: an answer with nothing
 * waiting is a real anomaly (an engine reply to a request this session never
 * made, or a broken ordering contract) and must read as unhandled rather than
 * be silently absorbed.
 */
export function deliverRaycast2dAnswer(answer: Raycast2dHit | null): boolean {
  const entry = queue.shift();
  if (!entry) {
    console.warn('[forge:physics2d] raycast answer arrived with no request awaiting it');
    return false;
  }
  if (entry.settled) {
    // The slot was abandoned (timeout/abort). Its answer is consumed here so
    // the queue stays aligned, and discarded — nobody is listening.
    return true;
  }
  entry.settled = true;
  entry.detach();
  entry.resolve(answer);
  return true;
}

/**
 * Drop every outstanding slot. Called when play mode stops: a restarted game
 * must not inherit the previous session's alignment, and a script awaiting an
 * answer the engine will never send must not hang until its channel timeout.
 */
export function resetRaycast2dQueue(): void {
  const outstanding = queue.splice(0, queue.length);
  for (const entry of outstanding) {
    if (entry.settled) continue;
    entry.settled = true;
    entry.detach();
    entry.reject(new Error('2D raycast discarded: play mode stopped'));
  }
}
