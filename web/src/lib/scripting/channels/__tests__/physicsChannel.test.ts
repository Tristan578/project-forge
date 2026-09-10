/**
 * Unit tests for the physics channel handler (physicsChannel.ts).
 *
 * Tests cover: raycast, raycast2d, isGrounded, overlapSphere, unknown method,
 * null/undefined return handling, and argument forwarding.
 *
 * The 2D blocks run end to end across the correlation seam: they dispatch
 * through the handler and answer through `deliverRaycast2dAnswer`, the function
 * `physicsEvents.ts` calls when the engine's `RAYCAST2D_HIT`/`RAYCAST2D_MISS`
 * event lands. The earlier version of this file asserted only what the handler
 * SENT — and what it sent was `raycast2d_query`, a command name the engine has
 * never implemented, with `handle_command`'s own return value read as the
 * raycast answer. The mock agreed with every line of that for as long as it
 * existed (lessons-learned #14).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPhysicsHandler } from '../physicsChannel';
import {
  awaitRaycast2dAnswer,
  deliverRaycast2dAnswer,
  pendingRaycast2dCount,
  resetRaycast2dQueue,
  MAX_PENDING_RAYCASTS_2D,
  type Raycast2dHit,
} from '../../raycast2dRegistry';

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

const noProgress = vi.fn();

/** What `handle_command` returns for a command the engine accepted. */
const ACCEPTED = { success: true };

/**
 * Start `fn`, wait for it to claim its slot, then deliver the engine's answer.
 * The engine emits from a later Bevy tick and never from inside
 * `handle_command`, so the answer is delivered after a turn of the microtask
 * queue here for the same reason.
 */
async function answerNextRaycast<T>(
  fn: () => Promise<T>,
  answer: Raycast2dHit | null,
): Promise<T> {
  const running = fn();
  await Promise.resolve();
  await Promise.resolve();
  expect(pendingRaycast2dCount()).toBe(1);
  deliverRaycast2dAnswer(answer);
  return running;
}

describe('createPhysicsHandler', () => {
  beforeEach(() => {
    resetRaycast2dQueue();
  });

  afterEach(() => {
    resetRaycast2dQueue();
  });

  describe('raycast', () => {
    it('dispatches raycast_query with origin/direction/maxDistance', async () => {
      const dispatchCommand = vi.fn(() => ({ entityId: 'e1', distance: 5 }));
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler(
        'raycast',
        { origin: [0, 1, 0], direction: [0, -1, 0], maxDistance: 20 },
        noProgress,
        makeSignal(),
      );

      expect(dispatchCommand).toHaveBeenCalledWith('raycast_query', {
        origin: [0, 1, 0],
        direction: [0, -1, 0],
        maxDistance: 20,
      });
      expect(result).toEqual({ entityId: 'e1', distance: 5 });
    });

    it('uses default maxDistance of 100 when not provided', async () => {
      const dispatchCommand = vi.fn(() => null);
      const handler = createPhysicsHandler({ dispatchCommand });

      await handler('raycast', { origin: [0, 0, 0], direction: [1, 0, 0] }, noProgress, makeSignal());

      expect(dispatchCommand).toHaveBeenCalledWith(
        'raycast_query',
        expect.objectContaining({ maxDistance: 100 }),
      );
    });

    it('returns null when dispatchCommand returns null', async () => {
      const dispatchCommand = vi.fn(() => null);
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler(
        'raycast',
        { origin: [0, 0, 0], direction: [0, 1, 0] },
        noProgress,
        makeSignal(),
      );

      expect(result).toBeNull();
    });

    it('returns null when dispatchCommand returns undefined', async () => {
      const dispatchCommand = vi.fn(() => undefined);
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler(
        'raycast',
        { origin: [0, 0, 0], direction: [0, 1, 0] },
        noProgress,
        makeSignal(),
      );

      expect(result).toBeNull();
    });
  });

  describe('raycast2d', () => {
    it('dispatches the engine command raycast2d and resolves with the hit', async () => {
      const dispatchCommand = vi.fn(() => ACCEPTED);
      const handler = createPhysicsHandler({ dispatchCommand });

      const hit: Raycast2dHit = {
        entityId: 'ground',
        point: { x: 1, y: -3 },
        normal: { x: 0, y: 1 },
        distance: 5,
      };

      const result = await answerNextRaycast(
        () =>
          handler(
            'raycast2d',
            { originX: 1, originY: 2, dirX: 0, dirY: -1, maxDistance: 5 },
            noProgress,
            makeSignal(),
          ),
        hit,
      );

      // `raycast2d`, NOT `raycast2d_query` — the latter has never existed in
      // `engine/src/core/commands/physics.rs`.
      expect(dispatchCommand).toHaveBeenCalledWith('raycast2d', {
        originX: 1,
        originY: 2,
        dirX: 0,
        dirY: -1,
        maxDistance: 5,
      });
      expect(result).toEqual(hit);
    });

    it('resolves with null on a MISS', async () => {
      const dispatchCommand = vi.fn(() => ACCEPTED);
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await answerNextRaycast(
        () =>
          handler(
            'raycast2d',
            { originX: 0, originY: 0, dirX: 0, dirY: -1 },
            noProgress,
            makeSignal(),
          ),
        null,
      );

      expect(result).toBeNull();
    });

    it('uses default maxDistance of 100 for raycast2d', async () => {
      const dispatchCommand = vi.fn(() => ACCEPTED);
      const handler = createPhysicsHandler({ dispatchCommand });

      await answerNextRaycast(
        () =>
          handler(
            'raycast2d',
            { originX: 0, originY: 0, dirX: 1, dirY: 0 },
            noProgress,
            makeSignal(),
          ),
        null,
      );

      expect(dispatchCommand).toHaveBeenCalledWith(
        'raycast2d',
        expect.objectContaining({ maxDistance: 100 }),
      );
    });

    it('does not cross the answers of two overlapping raycasts', async () => {
      const dispatchCommand = vi.fn(() => ACCEPTED);
      const handler = createPhysicsHandler({ dispatchCommand });

      const first = handler(
        'raycast2d',
        { originX: 0, originY: 0, dirX: 1, dirY: 0 },
        noProgress,
        makeSignal(),
      );
      await Promise.resolve();
      await Promise.resolve();
      const second = handler(
        'raycast2d',
        { originX: 9, originY: 9, dirX: -1, dirY: 0 },
        noProgress,
        makeSignal(),
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(pendingRaycast2dCount()).toBe(2);

      const firstHit: Raycast2dHit = {
        entityId: 'first-target',
        point: { x: 1, y: 0 },
        normal: { x: -1, y: 0 },
        distance: 1,
      };
      const secondHit: Raycast2dHit = {
        entityId: 'second-target',
        point: { x: 8, y: 9 },
        normal: { x: 1, y: 0 },
        distance: 1,
      };
      deliverRaycast2dAnswer(firstHit);
      deliverRaycast2dAnswer(secondHit);

      await expect(first).resolves.toEqual(firstHit);
      await expect(second).resolves.toEqual(secondHit);
    });

    /**
     * THE CROSSING THE COUNT COULD NOT SEE. The refusal path used to call
     * `deliverRaycast2dAnswer(null)`, which shifts the QUEUE HEAD — a different
     * request whenever anything else is in flight. So a refusal handed request A
     * a MISS the engine never sent, and A's real answer later settled B's
     * orphaned slot and was discarded.
     *
     * The existing case below asserts `pendingRaycast2dCount() === 0` on an
     * EMPTY queue, where the count recovers even though the identity is wrong,
     * so it can never observe this. Asserting on WHO got the answer is what
     * catches it (lessons-learned #11: a count standing in for an identity).
     */
    it('a refused cast does not settle a different request that is still waiting', async () => {
      const accepting = vi.fn(() => ACCEPTED);
      const handler = createPhysicsHandler({ dispatchCommand: accepting });

      let aSettled: unknown = 'PENDING';
      const a = handler('raycast2d', { originX: 0, originY: 0, dirX: 1, dirY: 0 }, noProgress, makeSignal())
        .then((v) => { aSettled = v; });
      await Promise.resolve();
      await Promise.resolve();
      expect(pendingRaycast2dCount()).toBe(1);

      const refusing = vi.fn(() => ({ success: false, error: 'boom' }));
      const refused = createPhysicsHandler({ dispatchCommand: refusing });
      await expect(
        refused('raycast2d', { originX: 9, originY: 9, dirX: -1, dirY: 0 }, noProgress, makeSignal()),
      ).rejects.toThrow(/boom/);

      // A is untouched: no engine event has been delivered for it.
      await Promise.resolve();
      expect(aSettled).toBe('PENDING');
      expect(pendingRaycast2dCount()).toBe(1);

      // And A's own answer still reaches A.
      const hit: Raycast2dHit = {
        entityId: 'a-target',
        point: { x: 1, y: 0 },
        normal: { x: -1, y: 0 },
        distance: 1,
      };
      deliverRaycast2dAnswer(hit);
      await a;
      expect(aSettled).toEqual(hit);
    });

    it('throws when the engine refuses the command, and claims no slot', async () => {
      const dispatchCommand = vi.fn(() => ({ success: false, error: 'Invalid raycast2d payload' }));
      const handler = createPhysicsHandler({ dispatchCommand });

      await expect(
        handler('raycast2d', { originX: 0, originY: 0, dirX: 0, dirY: -1 }, noProgress, makeSignal()),
      ).rejects.toThrow(/Invalid raycast2d payload/);
      // A refused command produces no engine event, so a slot claimed for it
      // would swallow the answer belonging to the request after it.
      expect(pendingRaycast2dCount()).toBe(0);
    });

    it('throws when the engine is unavailable and returns nothing', async () => {
      const dispatchCommand = vi.fn(() => undefined);
      const handler = createPhysicsHandler({ dispatchCommand });

      await expect(
        handler('raycast2d', { originX: 0, originY: 0, dirX: 0, dirY: -1 }, noProgress, makeSignal()),
      ).rejects.toThrow(/engine/i);
      expect(pendingRaycast2dCount()).toBe(0);
    });

    // The three cases below are the OPPOSITE direction of the fault the two
    // above cover. There, a slot was claimed for a command the engine never
    // received. Here, a command reaches the engine with no slot claimed for it —
    // and that direction is the worse of the two, because the surplus answer is
    // not dropped. It is handed to whichever request sits at the head of the
    // queue: a live caller, resolved with a stranger's hit.

    it('does not dispatch when the signal was already aborted', async () => {
      const dispatchCommand = vi.fn(() => ACCEPTED);
      const handler = createPhysicsHandler({ dispatchCommand });

      await expect(
        handler(
          'raycast2d',
          { originX: 0, originY: 0, dirX: 0, dirY: -1 },
          noProgress,
          AbortSignal.abort(),
        ),
      ).rejects.toThrow(/aborted/i);
      expect(dispatchCommand).not.toHaveBeenCalled();
      expect(pendingRaycast2dCount()).toBe(0);
    });

    it('an aborted cast does not give the next cast an answer that is not its own', async () => {
      const dispatchCommand = vi.fn(() => ACCEPTED);
      const handler = createPhysicsHandler({ dispatchCommand });

      await handler(
        'raycast2d',
        { originX: 0, originY: 0, dirX: 0, dirY: -1 },
        noProgress,
        AbortSignal.abort(),
      ).catch(() => undefined);

      // The engine owes exactly one answer from here. Had the aborted cast
      // dispatched it would owe two, the first belonging to nobody — and that
      // first one is what would settle the slot claimed below.
      const live = await answerNextRaycast(
        () =>
          handler(
            'raycast2d',
            { originX: 9, originY: 9, dirX: 1, dirY: 0 },
            noProgress,
            makeSignal(),
          ),
        { entityId: 'wall', point: { x: 10, y: 9 }, normal: { x: -1, y: 0 }, distance: 1 },
      );

      expect(live).toEqual(expect.objectContaining({ entityId: 'wall' }));
      expect(dispatchCommand).toHaveBeenCalledTimes(1);
      expect(dispatchCommand).toHaveBeenCalledWith(
        'raycast2d',
        expect.objectContaining({ originX: 9 }),
      );
    });

    it('does not dispatch when the outstanding-request ceiling is already reached', async () => {
      // Filled through the registry directly: the ceiling is the registry's
      // property, and what is under test is what the CHANNEL does on hitting it.
      const held = Array.from({ length: MAX_PENDING_RAYCASTS_2D }, () =>
        awaitRaycast2dAnswer());
      held.forEach((slot) => slot.answer.catch(() => undefined));
      expect(pendingRaycast2dCount()).toBe(MAX_PENDING_RAYCASTS_2D);

      const dispatchCommand = vi.fn(() => ACCEPTED);
      const handler = createPhysicsHandler({ dispatchCommand });

      await expect(
        handler(
          'raycast2d',
          { originX: 0, originY: 0, dirX: 0, dirY: -1 },
          noProgress,
          makeSignal(),
        ),
      ).rejects.toThrow(/Too many 2D raycasts/);
      expect(dispatchCommand).not.toHaveBeenCalled();
      expect(pendingRaycast2dCount()).toBe(MAX_PENDING_RAYCASTS_2D);
    });
  });

  describe('isGrounded', () => {
    it('casts down from the caller-supplied origin using the real raycast2d command', async () => {
      const dispatchCommand = vi.fn(() => ACCEPTED);
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await answerNextRaycast(
        () =>
          handler(
            'isGrounded',
            { entityId: 'player', originX: 4, originY: 2, distance: 0.15 },
            noProgress,
            makeSignal(),
          ),
        {
          entityId: 'ground',
          point: { x: 4, y: 1.9 },
          normal: { x: 0, y: 1 },
          distance: 0.1,
        },
      );

      expect(dispatchCommand).toHaveBeenCalledWith('raycast2d', {
        originX: 4,
        originY: 2,
        dirX: 0,
        dirY: -1,
        maxDistance: 0.15,
        excludeEntityId: 'player',
      });
      expect(result).toBe(true);
    });

    /**
     * THE EXCLUSION IS THE ONLY THING THAT MAKES THIS ANSWERABLE, and it has to
     * be asked for on the wire. `cast_ray` is called with `solid: true`, which
     * returns `toi = 0` for a ray whose origin lies INSIDE a collider — and a
     * ground check starts at the entity's own position, inside its own. So the
     * closest hit is always the caster itself, at distance 0, and every other
     * collider is behind it and never reported.
     *
     * The `hit.entityId !== casterId` check below turns that into `false`, which
     * is the right answer to the wrong question: it means a grounded entity
     * reads as airborne, permanently. Filtering the caster out in the engine is
     * what lets the ray reach the floor at all, so what this pins is that the
     * channel actually SENDS the exclusion. Drop the field and the payload is
     * still valid, the engine still answers, and every `isGrounded` is false.
     */
    it('asks the engine to exclude the caster from its own ground ray', async () => {
      const dispatchCommand = vi.fn(() => ACCEPTED);
      const handler = createPhysicsHandler({ dispatchCommand });

      await answerNextRaycast(
        () =>
          handler(
            'isGrounded',
            { entityId: 'player', originX: 0, originY: 0 },
            noProgress,
            makeSignal(),
          ),
        null,
      );

      expect(dispatchCommand).toHaveBeenCalledWith(
        'raycast2d',
        expect.objectContaining({ excludeEntityId: 'player' }),
      );
    });

    /**
     * A plain `raycast2d` from a script is NOT a ground check: it is asked from
     * an arbitrary origin at an arbitrary target, and excluding anything would
     * be inventing a filter the caller never asked for.
     */
    it('sends no exclusion for a plain raycast2d', async () => {
      // Parameters declared so `mock.calls[0][1]` has a type; the payload is
      // read positionally below rather than matched, because what is asserted
      // is the ABSENCE of a key and `objectContaining` cannot express that.
      const dispatchCommand = vi.fn((_command: string, _payload: unknown) => ACCEPTED);
      const handler = createPhysicsHandler({ dispatchCommand });

      await answerNextRaycast(
        () =>
          handler(
            'raycast2d',
            { originX: 0, originY: 0, dirX: 1, dirY: 0 },
            noProgress,
            makeSignal(),
          ),
        null,
      );

      const payload = dispatchCommand.mock.calls[0][1] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('excludeEntityId');
    });

    it('returns false on a MISS', async () => {
      const dispatchCommand = vi.fn(() => ACCEPTED);
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await answerNextRaycast(
        () =>
          handler(
            'isGrounded',
            { entityId: 'player', originX: 0, originY: 0 },
            noProgress,
            makeSignal(),
          ),
        null,
      );

      expect(result).toBe(false);
    });

    /**
     * `apply_raycast2d_requests` casts with `QueryFilter::default()`, which has
     * no self-exclusion, so a ray starting inside the caller's own collider
     * answers with the caller at distance 0. That is not ground.
     */
    it('does not count the caster hitting itself as ground', async () => {
      const dispatchCommand = vi.fn(() => ACCEPTED);
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await answerNextRaycast(
        () =>
          handler(
            'isGrounded',
            { entityId: 'player', originX: 0, originY: 0 },
            noProgress,
            makeSignal(),
          ),
        {
          entityId: 'player',
          point: { x: 0, y: 0 },
          normal: { x: 0, y: 1 },
          distance: 0,
        },
      );

      expect(result).toBe(false);
    });

    it('uses default distance of 0.1 when not provided', async () => {
      const dispatchCommand = vi.fn(() => ACCEPTED);
      const handler = createPhysicsHandler({ dispatchCommand });

      await answerNextRaycast(
        () =>
          handler(
            'isGrounded',
            { entityId: 'e1', originX: 0, originY: 0 },
            noProgress,
            makeSignal(),
          ),
        null,
      );

      expect(dispatchCommand).toHaveBeenCalledWith(
        'raycast2d',
        expect.objectContaining({ maxDistance: 0.1 }),
      );
    });

    it('answers false without dispatching when the caller has no known position', async () => {
      const dispatchCommand = vi.fn(() => ACCEPTED);
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler('isGrounded', { entityId: 'e1' }, noProgress, makeSignal());

      expect(result).toBe(false);
      expect(dispatchCommand).not.toHaveBeenCalled();
      expect(pendingRaycast2dCount()).toBe(0);
    });
  });

  describe('overlapSphere', () => {
    it('dispatches overlap_sphere_query with center and radius', async () => {
      const dispatchCommand = vi.fn(() => ['e1', 'e2', 'e3']);
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler(
        'overlapSphere',
        { center: [0, 1, 0], radius: 2.5 },
        noProgress,
        makeSignal(),
      );

      expect(dispatchCommand).toHaveBeenCalledWith('overlap_sphere_query', {
        center: [0, 1, 0],
        radius: 2.5,
      });
      expect(result).toEqual(['e1', 'e2', 'e3']);
    });

    it('uses default radius of 1.0 when not provided', async () => {
      const dispatchCommand = vi.fn(() => []);
      const handler = createPhysicsHandler({ dispatchCommand });

      await handler('overlapSphere', { center: [0, 0, 0] }, noProgress, makeSignal());

      expect(dispatchCommand).toHaveBeenCalledWith(
        'overlap_sphere_query',
        expect.objectContaining({ radius: 1.0 }),
      );
    });

    it('returns empty array when no entities overlap', async () => {
      const dispatchCommand = vi.fn(() => null);
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler(
        'overlapSphere',
        { center: [0, 0, 0] },
        noProgress,
        makeSignal(),
      );

      expect(result).toEqual([]);
    });

    it('returns empty array when dispatchCommand returns undefined', async () => {
      const dispatchCommand = vi.fn(() => undefined);
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler(
        'overlapSphere',
        { center: [0, 0, 0] },
        noProgress,
        makeSignal(),
      );

      expect(result).toEqual([]);
    });
  });

  describe('unknown method', () => {
    it('throws for unknown physics method', async () => {
      const dispatchCommand = vi.fn();
      const handler = createPhysicsHandler({ dispatchCommand });

      await expect(
        handler('teleport', {}, noProgress, makeSignal()),
      ).rejects.toThrow('Unknown physics method: teleport');
    });

    it('does not call dispatchCommand for unknown methods', async () => {
      const dispatchCommand = vi.fn();
      const handler = createPhysicsHandler({ dispatchCommand });

      await handler('badMethod', {}, noProgress, makeSignal()).catch(() => {});

      expect(dispatchCommand).not.toHaveBeenCalled();
    });
  });
});
