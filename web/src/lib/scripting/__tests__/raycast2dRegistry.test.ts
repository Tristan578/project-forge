/**
 * The correlation half of the 2D raycast round trip (PF-1169 / #9271).
 *
 * The engine's `raycast2d` answer carries NO request id — `emit_raycast2d_hit`
 * sends `{ entityId, pointX, pointY, normalX, normalY, distance }` and
 * `emit_raycast2d_miss` sends `{}`. Correlation therefore rests entirely on the
 * engine's ordering contract, which these tests pin from the browser side:
 * `apply_raycast2d_requests` drains `pending.raycast2d_requests` in queue order
 * and every branch emits EXACTLY ONE event per request. So the Nth answer
 * belongs to the Nth accepted request, and the registry is a FIFO.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  awaitRaycast2dAnswer,
  deliverRaycast2dAnswer,
  pendingRaycast2dCount,
  resetRaycast2dQueue,
  MAX_PENDING_RAYCASTS_2D,
} from '../raycast2dRegistry';

const HIT = {
  entityId: 'ground-1',
  point: { x: 1, y: -2 },
  normal: { x: 0, y: 1 },
  distance: 2,
};

describe('raycast2dRegistry', () => {
  beforeEach(() => {
    resetRaycast2dQueue();
  });

  afterEach(() => {
    resetRaycast2dQueue();
    vi.restoreAllMocks();
  });

  it('resolves a pending request with the hit that follows it', async () => {
    const answer = awaitRaycast2dAnswer().answer;
    expect(pendingRaycast2dCount()).toBe(1);

    expect(deliverRaycast2dAnswer(HIT)).toBe(true);
    await expect(answer).resolves.toEqual(HIT);
    expect(pendingRaycast2dCount()).toBe(0);
  });

  it('resolves with null on a miss', async () => {
    const answer = awaitRaycast2dAnswer().answer;
    expect(deliverRaycast2dAnswer(null)).toBe(true);
    await expect(answer).resolves.toBeNull();
  });

  it('does not cross the answers of two overlapping raycasts', async () => {
    const first = awaitRaycast2dAnswer().answer;
    const second = awaitRaycast2dAnswer().answer;

    const firstHit = { ...HIT, entityId: 'first-target' };
    const secondHit = { ...HIT, entityId: 'second-target' };

    deliverRaycast2dAnswer(firstHit);
    deliverRaycast2dAnswer(secondHit);

    await expect(first).resolves.toEqual(firstHit);
    await expect(second).resolves.toEqual(secondHit);
  });

  it('keeps a MISS in the right slot when it lands between two hits', async () => {
    const a = awaitRaycast2dAnswer().answer;
    const b = awaitRaycast2dAnswer().answer;
    const c = awaitRaycast2dAnswer().answer;

    deliverRaycast2dAnswer(HIT);
    deliverRaycast2dAnswer(null);
    deliverRaycast2dAnswer({ ...HIT, entityId: 'third' });

    await expect(a).resolves.toEqual(HIT);
    await expect(b).resolves.toBeNull();
    await expect(c).resolves.toEqual({ ...HIT, entityId: 'third' });
  });

  it('reports an answer with nothing waiting as unhandled', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(deliverRaycast2dAnswer(HIT)).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  /**
   * The alignment guarantee is what makes an abandoned request dangerous: if
   * the timed-out slot were simply dropped, the answer the engine still owes it
   * would resolve the NEXT request and every later answer would be off by one.
   * The slot is tombstoned instead — kept in the queue, settled, and discarded
   * when its own answer arrives.
   */
  it('discards the answer owed to an abandoned request without shifting the rest', async () => {
    const controller = new AbortController();
    const abandoned = awaitRaycast2dAnswer(controller.signal).answer;
    const live = awaitRaycast2dAnswer().answer;

    controller.abort();
    await expect(abandoned).rejects.toThrow(/abort/i);
    expect(pendingRaycast2dCount()).toBe(2);

    // The engine still answers the abandoned request first.
    deliverRaycast2dAnswer({ ...HIT, entityId: 'answer-for-abandoned' });
    deliverRaycast2dAnswer({ ...HIT, entityId: 'answer-for-live' });

    await expect(live).resolves.toEqual({ ...HIT, entityId: 'answer-for-live' });
  });

  /**
   * The same alignment guarantee, reached the other way round. A slot can be
   * abandoned TWICE: once by an abort, and then again by the caller's own
   * failure path — the physics channel calls `abandon` on any dispatch that
   * throws, and a cast can abort while that dispatch is in flight.
   *
   * The second call must do nothing. The first abandonment already tombstoned
   * the slot, and a tombstone is a slot the engine still owes an answer to; the
   * only reason it stays in the queue is to absorb that answer. Removing it
   * hands the engine's next reply to the request behind it, which is the
   * off-by-one this module exists to prevent — arriving through the release
   * path meant to prevent it.
   */
  it('does not remove an already-tombstoned slot when it is abandoned again', async () => {
    const controller = new AbortController();
    const slot = awaitRaycast2dAnswer(controller.signal);
    const abandoned = slot.answer;
    const live = awaitRaycast2dAnswer().answer;

    controller.abort();
    await expect(abandoned).rejects.toThrow(/abort/i);

    // The caller's failure path now runs on a slot the abort already settled.
    slot.abandon('dispatch failed');
    expect(pendingRaycast2dCount()).toBe(2);

    // The engine answers the tombstone first, exactly as it would have.
    deliverRaycast2dAnswer({ ...HIT, entityId: 'answer-for-abandoned' });
    deliverRaycast2dAnswer({ ...HIT, entityId: 'answer-for-live' });

    await expect(live).resolves.toEqual({ ...HIT, entityId: 'answer-for-live' });
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const slot = awaitRaycast2dAnswer(controller.signal);
    await expect(slot.answer).rejects.toThrow(/abort/i);
    // Nothing was enqueued, so no answer is owed and alignment is untouched —
    // and `queued` is what says so to the caller, which must not dispatch.
    expect(slot.queued).toBe(false);
    expect(pendingRaycast2dCount()).toBe(0);
  });

  it('reports a claimed slot as queued, so its caller may dispatch', () => {
    const slot = awaitRaycast2dAnswer();
    expect(slot.queued).toBe(true);
    slot.answer.catch(() => undefined);
  });

  it('rejects a new request once the queue is saturated', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const inFlight: Promise<unknown>[] = [];
    for (let i = 0; i < MAX_PENDING_RAYCASTS_2D; i++) {
      inFlight.push(awaitRaycast2dAnswer().answer.catch(() => null));
    }
    const refused = awaitRaycast2dAnswer();
    await expect(refused.answer).rejects.toThrow(/too many/i);
    // Same as the pre-aborted case: nothing enqueued, so nothing may be sent.
    expect(refused.queued).toBe(false);
    expect(pendingRaycast2dCount()).toBe(MAX_PENDING_RAYCASTS_2D);

    resetRaycast2dQueue();
    await Promise.all(inFlight);
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects everything still waiting when the queue is reset', async () => {
    const pending = awaitRaycast2dAnswer().answer;
    resetRaycast2dQueue();
    await expect(pending).rejects.toThrow(/stopped/i);
    expect(pendingRaycast2dCount()).toBe(0);
  });
});
