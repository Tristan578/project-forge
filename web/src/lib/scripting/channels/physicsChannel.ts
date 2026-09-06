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
import {
  awaitRaycast2dAnswer,
  deliverRaycast2dAnswer,
  type Raycast2dHit,
} from '../raycast2dRegistry';

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
   */
  async function castRay2d(
    payload: Raycast2dArgs,
    signal: AbortSignal | undefined,
  ): Promise<Raycast2dHit | null> {
    const answer = awaitRaycast2dAnswer(signal);
    // Settled here so a rejection on the failure path below is never reported
    // as unhandled; the caller still sees the throw.
    answer.catch(() => undefined);
    try {
      acceptedOrThrow(deps.dispatchCommand('raycast2d', payload));
    } catch (err) {
      deliverRaycast2dAnswer(null);
      throw err;
    }
    return answer;
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
        if (typeof originX !== 'number' || typeof originY !== 'number') return false;

        const hit = await castRay2d(
          {
            originX,
            originY,
            dirX: 0,
            dirY: -1,
            maxDistance: (args.distance as number | undefined) ?? 0.1,
          },
          signal,
        );
        if (hit === null) return false;
        // `apply_raycast2d_requests` casts with `QueryFilter::default()`, which
        // has no self-exclusion, so a ray starting inside the caller's own
        // collider answers with the caller at distance 0. Standing on yourself
        // is not standing on the ground.
        return hit.entityId !== args.entityId;
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
