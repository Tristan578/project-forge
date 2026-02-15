/**
 * Event handlers for physics, joints, physics2d, collisions, raycasts.
 */

import { useEditorStore, type PhysicsData, type JointData } from '@/stores/editorStore';
import { getScriptCollisionCallback } from '@/lib/scripting/useScriptRunner';
import type { SetFn, GetFn } from './types';

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
