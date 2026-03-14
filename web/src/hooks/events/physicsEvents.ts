/**
 * Event handlers for physics, joints, physics2d, collisions, raycasts.
 */

import { useEditorStore, type PhysicsData, type JointData } from '@/stores/editorStore';
import { getScriptCollisionCallback } from '@/lib/scripting/useScriptRunner';
import { audioManager } from '@/lib/audio/audioManager';
import type { SetFn, GetFn } from './types';

/** Prefix used to identify audio occlusion raycast requests. */
const OCCLUSION_RAYCAST_PREFIX = 'audio_occlusion:';

export function handlePhysicsEvent(
  type: string,
  data: Record<string, unknown>,
  _set: SetFn,
  _get: GetFn
): boolean {
  switch (type) {
    case 'PHYSICS_CHANGED': {
      const payload = data as unknown as PhysicsData & { entityId: string; enabled: boolean };
      const { entityId: _physId, enabled, ...physData } = payload;
      useEditorStore.getState().setPrimaryPhysics(physData as PhysicsData, enabled);
      return true;
    }

    case 'JOINT_CHANGED': {
      const payload = data as unknown as JointData | null;
      useEditorStore.getState().setPrimaryJoint(payload);
      return true;
    }

    case 'DEBUG_PHYSICS_CHANGED': {
      const payload = data as unknown as { enabled: boolean };
      useEditorStore.getState().setDebugPhysics(payload.enabled);
      return true;
    }

    case 'PHYSICS2D_UPDATED': {
      const payload = data as unknown as import('@/stores/editorStore').Physics2dData & { entityId: string; enabled: boolean };
      const { entityId, enabled, ...physData } = payload;
      useEditorStore.getState().setPhysics2d(entityId, physData, enabled);
      return true;
    }

    case 'JOINT2D_UPDATED': {
      const payload = data as unknown as import('@/stores/editorStore').Joint2dData & { entityId: string };
      const { entityId, ...jointData } = payload;
      useEditorStore.getState().setJoint2d(entityId, jointData);
      return true;
    }

    case 'PHYSICS2D_REMOVED': {
      const payload = data as unknown as { entityId: string };
      useEditorStore.getState().removePhysics2d(payload.entityId);
      return true;
    }

    case 'COLLISION_EVENT': {
      const payload = data as unknown as { entityA: string; entityB: string; started: boolean };
      const collisionCb = getScriptCollisionCallback();
      if (collisionCb) {
        collisionCb(payload);
      }
      return true;
    }

    case 'RAYCAST_RESULT': {
      const payload = data as unknown as { requestId: string; hitEntity: string | null; point: [number, number, number]; distance: number };
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
      const raycastCb = (window as unknown as { __scriptRaycastCallback?: (event: { requestId: string; hitEntity: string | null; point: [number, number, number]; distance: number }) => void }).__scriptRaycastCallback;
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
