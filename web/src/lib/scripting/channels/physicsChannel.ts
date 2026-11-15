// Physics channel handler — dispatches raycast/isGrounded queries to the WASM
// engine.
//
// THE 2D PATH IS ASYNCHRONOUS, and it did not used to be. `raycast2d` queues a
// request that Bevy services on a LATER tick and answers by emitting
// `RAYCAST2D_HIT` or `RAYCAST2D_MISS` (`engine/src/bridge/physics.rs`,
// `apply_raycast2d_requests`). `handle_command`'s own return value says only
// whether the command was accepted; it can never carry the result.
//
// This file used to dispatch `raycast2d_query` — a command name the engine has
// never implemented — and read the acceptance envelope as the answer. So every
// script raycast returned that envelope or null, and the engine's two events
// reached nobody at all (#9271). The unit tests agreed with all of it, because
// a mock cannot disagree with you (lessons-learned #14).
//
// The answer is therefore correlated through `raycast2dRegistry`: claim a slot,
// dispatch, await. The order matters — see `castRay2d`.

import type { AsyncHandler } from '../asyncChannelRouter';
import { awaitRaycast2dAnswer, type Raycast2dHit } from '../raycast2dRegistry';

export interface PhysicsChannelDeps {
  dispatchCommand: (command: string, payload: unknown) => unknown;
}

/** The `raycast2d` payload the engine deserialises (`Raycast2dPayload`). */
interface Raycast2dArgs {
  originX: number;
  originY: number;
  dirX: number;
  dirY: number;
  maxDistance: number;
  /**
   * An entity the engine must filter out of this cast
   * (`QueryFilter::exclude_collider`). Omitted for an ordinary script raycast —
   * see `isGrounded`, which is the only caller with a reason to set it.
   */
  excludeEntityId?: string;
}

/**
 * Did `handle_command` accept the command? Throws with the engine's own reason
 * if not, and on an absent return, which is what a torn-down engine gives.
 */
function acceptedOrThrow(result: unknown): void {
  if (result == null) {
    throw new Error('2D raycast failed: the engine is unavailable');
  }
  if (
    typeof result === 'object'
    && 'success' in result
    && (result as { success: unknown }).success === false
  ) {
    const reason = (result as { error?: unknown }).error;
    throw new Error(
      `2D raycast refused by the engine: ${typeof reason === 'string' ? reason : 'unknown error'}`,
    );
  }
}

export function createPhysicsHandler(deps: PhysicsChannelDeps): AsyncHandler {
  /**
   * Dispatch one `raycast2d` and resolve with the engine's answer.
   *
   * A REFUSED COMMAND MUST LEAVE NO SLOT BEHIND. The engine emits nothing for a
   * command it rejected, so a slot claimed for one would be filled by the answer
   * belonging to the NEXT request, putting every later raycast off by one —
   * exactly the crossing the registry exists to prevent. The slot is released
   * on the failure path rather than left for the queue to drift on.
   *
   * AND NO COMMAND MAY GO OUT WITHOUT A SLOT, which is the same fault mirrored.
   * `awaitRaycast2dAnswer` refuses two ways — an already-aborted signal, and the
   * outstanding-request ceiling — and both hand back a slot that was never
   * enqueued. Dispatching on one sends the engine a request nobody is waiting
   * for, and its answer is not discarded: it goes to the head of the queue, so
   * a live caller is resolved with a stranger's hit. Measured before the
   * `queued` check existed: one dispatch after a pre-aborted signal, one after
   * the ceiling, and the following cast receiving the answer to neither of its
   * own.
   */
  async function castRay2d(
    payload: Raycast2dArgs,
    signal: AbortSignal | undefined,
  ): Promise<Raycast2dHit | null> {
    const slot = awaitRaycast2dAnswer(signal);
    // Settled here so a rejection on the failure path below is never reported
    // as unhandled; the caller still sees the throw.
    slot.answer.catch(() => undefined);
    // No slot, no dispatch. `slot.answer` already carries the registry's own
    // reason for the refusal, so it is returned rather than restated.
    if (!slot.queued) return slot.answer;
    try {
      acceptedOrThrow(deps.dispatchCommand('raycast2d', payload));
    } catch (err) {
      // `slot.abandon`, NOT `deliverRaycast2dAnswer(null)`. The latter settles
      // the QUEUE HEAD, which is a different request whenever anything else is
      // in flight — so a refusal here handed that request a MISS the engine
      // never sent, and its real answer later settled this orphaned slot and
      // was discarded. Measured on two overlapping casts.
      slot.abandon(err instanceof Error ? err.message : '2D raycast dispatch failed');
      throw err;
    }
    return slot.answer;
  }

  return async (method: string, args: Record<string, unknown>, _reportProgress, signal) => {
    switch (method) {
      case 'raycast': {
        const result = deps.dispatchCommand('raycast_query', {
          origin: args.origin,
          direction: args.direction,
          maxDistance: args.maxDistance ?? 100,
        });
        return result ?? null;
      }
      case 'raycast2d': {
        return castRay2d(
          {
            originX: args.originX as number,
            originY: args.originY as number,
            dirX: args.dirX as number,
            dirY: args.dirY as number,
            maxDistance: (args.maxDistance as number | undefined) ?? 100,
          },
          signal,
        );
      }
      case 'isGrounded': {
        // A DOWNWARD CAST FROM THE CALLER'S OWN POSITION, which the caller
        // supplies. The previous version sent `originX: 0, originY: 0` with a
        // `fromEntity: true` flag the engine does not read, so every ground
        // check was cast from the world origin regardless of where the entity
        // stood. With no position there is no question to ask, so this answers
        // false rather than casting from somewhere arbitrary.
        const originX = args.originX;
        const originY = args.originY;
        const casterId = args.entityId;
        // `entityId` is required, not optional, because the self-hit check below
        // is the only thing separating "standing on the ground" from "standing
        // inside my own collider". Without it, `undefined !== 'player'` scores a
        // distance-0 self-hit as ground and every entity reads as permanently
        // grounded — a wrong answer, which is worse here than no answer.
        if (
          typeof originX !== 'number'
          || typeof originY !== 'number'
          || typeof casterId !== 'string'
          || casterId === ''
        ) {
          return false;
        }

        const hit = await castRay2d(
          {
            originX,
            originY,
            dirX: 0,
            dirY: -1,
            maxDistance: (args.distance as number | undefined) ?? 0.1,
            // WITHOUT THIS THE QUESTION IS UNANSWERABLE. The ray starts at the
            // entity's own position, which is inside its own collider, and
            // `apply_raycast2d_requests` calls `cast_ray` with `solid: true` —
            // a ray originating inside a shape reports that shape at `toi = 0`.
            // So the closest hit is always the caster, every real surface is
            // behind it, and the check below turns that into a permanent
            // `false`. `exclude_collider` on the engine side is what lets the
            // ray reach the floor at all.
            excludeEntityId: casterId,
          },
          signal,
        );
        if (hit === null) return false;
        // Kept even with the exclusion above: an engine build that ignores the
        // field, or a caster whose id the engine cannot resolve to an entity,
        // falls back to the unfiltered cast — and standing on yourself is not
        // standing on the ground.
        return hit.entityId !== casterId;
      }
      case 'overlapSphere': {
        const result = deps.dispatchCommand('overlap_sphere_query', {
          center: args.center,
          radius: args.radius ?? 1.0,
        });
        return result ?? [];
      }
      default:
        throw new Error(`Unknown physics method: ${method}`);
    }
  };
}
