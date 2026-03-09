// Physics channel handler — dispatches raycast/isGrounded queries to WASM engine.

import type { AsyncHandler } from '../asyncChannelRouter';

export interface PhysicsChannelDeps {
  dispatchCommand: (command: string, payload: unknown) => unknown;
}

export function createPhysicsHandler(deps: PhysicsChannelDeps): AsyncHandler {
  return async (method: string, args: Record<string, unknown>, _reportProgress, _signal) => {
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
        const result = deps.dispatchCommand('raycast2d_query', {
          originX: args.originX,
          originY: args.originY,
          dirX: args.dirX,
          dirY: args.dirY,
          maxDistance: args.maxDistance ?? 100,
        });
        return result ?? null;
      }
      case 'isGrounded': {
        // Downward raycast to check if entity is on ground
        const result = deps.dispatchCommand('raycast2d_query', {
          entityId: args.entityId,
          originX: 0,
          originY: 0,
          dirX: 0,
          dirY: -1,
          maxDistance: args.distance ?? 0.1,
          fromEntity: true,
        });
        return result != null;
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
