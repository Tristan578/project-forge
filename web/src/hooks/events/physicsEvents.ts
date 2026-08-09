/**
 * Event handlers for physics, joints, physics2d, collisions, raycasts.
 */

import { useEditorStore, type PhysicsData, type JointData } from '@/stores/editorStore';
import { getScriptCollisionCallback } from '@/lib/scripting/useScriptRunner';
import { audioManager } from '@/lib/audio/audioManager';
import { castPayload, type SetFn, type GetFn } from './types';

/** Prefix used to identify audio occlusion raycast requests. */
const OCCLUSION_RAYCAST_PREFIX = 'audio_occlusion:';

/**
 * Route a PHYSICS_CHANGED payload into `primaryPhysics` only when it describes
 * the entity the inspector is actually showing.
 *
 * The engine emits PHYSICS_CHANGED for EVERY entity an `update_physics` touches,
 * not only the selected one — a Physics Feel "Apply" rewrites every physics
 * entity in the scene and fires one event per entity. `PhysicsInspector` edits
 * with `updatePhysics(primaryId, { ...primaryPhysics, ...partial })`, so a
 * foreign payload landing in `primaryPhysics` would write that entity's full
 * 13-field body onto the SELECTED entity the next time a slider moves — e.g.
 * flipping a `fixed` ground platform to `dynamic` so it falls out of the world
 * (PF-1118 review F2).
 *
 * Selection resolves one microtask late: `useEngineEvents` routes
 * SELECTION_CHANGED through `createSelectionBatcher`, which coalesces via
 * `queueMicrotask`, while PHYSICS_CHANGED is handled synchronously in the same
 * tick. On a viewport pick the store therefore still reports the PREVIOUS
 * primary when the newly-selected entity's physics arrives. A mismatch is
 * re-checked on a microtask of our own — queued after the batcher's, so the
 * selection has landed by then — instead of being dropped outright.
 *
 * With no selection at all there is nothing to protect: `InspectorPanel`
 * renders no inspector body without a `primaryId`, so no write-back path
 * exists and the payload is applied directly.
 */
function applyPrimaryPhysics(entityId: string, physData: PhysicsData, enabled: boolean): void {
  const primaryId = useEditorStore.getState().primaryId;

  if (primaryId == null || primaryId === entityId) {
    useEditorStore.getState().setPrimaryPhysics(physData, enabled);
    return;
  }

  queueMicrotask(() => {
    const state = useEditorStore.getState();
    if (state.primaryId === entityId) {
      state.setPrimaryPhysics(physData, enabled);
    }
  });
}

/** Script-side raycast callback registered by the scripting runtime. */
interface WindowWithScriptCallbacks {
  __scriptRaycastCallback?: (event: {
    requestId: string;
    hitEntity: string | null;
    point: [number, number, number];
    distance: number;
  }) => void;
}

export function handlePhysicsEvent(
  type: string,
  data: Record<string, unknown>,
  _set: SetFn,
  _get: GetFn
): boolean {
  switch (type) {
    case 'PHYSICS_CHANGED': {
      const payload = castPayload<PhysicsData & { entityId: string; enabled: boolean }>(data);
      const { entityId, enabled, ...physData } = payload;
      applyPrimaryPhysics(entityId, physData as PhysicsData, enabled);
      return true;
    }

    case 'JOINT_CHANGED': {
      const payload = castPayload<JointData | null>(data);
      useEditorStore.getState().setPrimaryJoint(payload);
      return true;
    }

    case 'DEBUG_PHYSICS_CHANGED': {
      const payload = castPayload<{ enabled: boolean }>(data);
      useEditorStore.getState().setDebugPhysics(payload.enabled);
      return true;
    }

    case 'PHYSICS2D_UPDATED': {
      const payload = castPayload<import('@/stores/editorStore').Physics2dData & { entityId: string; enabled: boolean }>(data);
      const { entityId, enabled, ...physData } = payload;
      useEditorStore.getState().setPhysics2d(entityId, physData, enabled);
      return true;
    }

    case 'JOINT2D_UPDATED': {
      const payload = castPayload<import('@/stores/editorStore').Joint2dData & { entityId: string }>(data);
      const { entityId, ...jointData } = payload;
      useEditorStore.getState().setJoint2d(entityId, jointData);
      return true;
    }

    case 'PHYSICS2D_REMOVED': {
      const payload = castPayload<{ entityId: string }>(data);
      useEditorStore.getState().removePhysics2d(payload.entityId);
      return true;
    }

    case 'COLLISION_EVENT': {
      const payload = castPayload<{ entityA: string; entityB: string; started: boolean }>(data);
      const collisionCb = getScriptCollisionCallback();
      if (collisionCb) {
        collisionCb(payload);
      }
      return true;
    }

    case 'RAYCAST_RESULT': {
      const payload = castPayload<{ requestId: string; hitEntity: string | null; point: [number, number, number]; distance: number }>(data);
      // Handle audio occlusion raycasts
      if (payload.requestId.startsWith(OCCLUSION_RAYCAST_PREFIX)) {
        // requestId format: "audio_occlusion:<entityId>:<totalDistance>"
        const rest = payload.requestId.slice(OCCLUSION_RAYCAST_PREFIX.length);
        const lastColon = rest.lastIndexOf(':');
        const entityId = lastColon >= 0 ? rest.slice(0, lastColon) : rest;
        const totalDistance = lastColon >= 0 ? parseFloat(rest.slice(lastColon + 1)) : 0;
        // Graduated occlusion: amount = 1 - (hitDistance / totalDistance)
        // No hit or hit self = fully clear (amount 0)
        const isBlocked = payload.hitEntity !== null && payload.hitEntity !== entityId;
        let amount = 0;
        if (isBlocked && totalDistance > 0) {
          amount = 1.0 - payload.distance / totalDistance;
          if (amount < 0) amount = 0;
          if (amount > 1) amount = 1;
        }
        audioManager.updateOcclusionAmount(entityId, amount);
        return true;
      }
      // Forward to script raycast callback
      const raycastCb = (window as WindowWithScriptCallbacks).__scriptRaycastCallback;
      if (raycastCb) {
        raycastCb(payload);
      }
      return true;
    }

    case 'RAYCAST2D_RESULT': {
      // Placeholder for 2D raycast results (similar pattern to RAYCAST_RESULT)
      return true;
    }

    default:
      return false;
  }
}
