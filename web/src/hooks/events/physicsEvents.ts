/**
 * Event handlers for physics, joints, physics2d, collisions, raycasts.
 */

import { useEditorStore, type PhysicsData, type JointData } from '@/stores/editorStore';
import { getScriptCollisionCallback } from '@/lib/scripting/useScriptRunner';
import { audioManager } from '@/lib/audio/audioManager';
import { parseJoint2dWire, parsePhysics2dWire } from '@/lib/physics/physics2dPayload';
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
 * No selection is NOT a safe case, and is handled by the same deferral. Writing
 * the payload straight through when `primaryId` is null looks harmless — nothing
 * renders it right now — but it survives in the store, so the next entity the
 * user selects inherits a foreign 13-field body as its inspector state and the
 * first slider move writes that body onto it. That is the same corruption the
 * mismatch branch exists to prevent, just deferred until selection. The only
 * case the deferral discards is "no entity is ever selected", where
 * `primaryPhysics` has no reader at all.
 */
function applyPrimaryPhysics(entityId: string, physData: PhysicsData, enabled: boolean): void {
  const primaryId = useEditorStore.getState().primaryId;

  if (primaryId === entityId) {
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

    /**
     * The engine emits `PHYSICS2D_CHANGED`. This case used to be spelled
     * `PHYSICS2D_UPDATED`, a name nothing has ever emitted, so the whole inbound
     * 2D physics path was dead alongside the outbound one (PF-1167).
     *
     * The payload cannot be spread into the store either: `emit_physics2d_changed`
     * FLATTENS `Physics2dData` into a camelCase wrapper, and `rename_all` does not
     * propagate into a flattened struct, so the data keys arrive snake_case with
     * PascalCase enum values. `parsePhysics2dWire` is the translation.
     *
     * It routes to `applyPhysics2dFromEngine`, not `setPhysics2d`, because the
     * latter dispatches `set_physics_2d` back at the engine — a full replace that
     * would reset any field this event did not carry.
     */
    case 'PHYSICS2D_CHANGED': {
      const parsed = parsePhysics2dWire(data);
      if (!parsed) return true;
      useEditorStore
        .getState()
        .applyPhysics2dFromEngine(parsed.entityId, parsed.data, parsed.enabled);
      return true;
    }

    /**
     * `JOINT2D_CHANGED` had no handler at all: the emitter FLATTENED
     * `PhysicsJoint2d` into a camelCase wrapper, and `rename_all` does not
     * propagate through `#[serde(flatten)]`, so the wire carried snake_case keys
     * around a nested, externally-tagged PascalCase `JointType2d` — a shape the
     * store's flat `Joint2dData` could not be built from. The engine now emits
     * the same flat vocabulary `set_joint_2d` reads (PF-1167).
     *
     * Routes to `applyJoint2dFromEngine`, not `setJoint2d`, because the latter
     * dispatches `set_joint_2d` back at the engine that just reported the joint.
     */
    case 'JOINT2D_CHANGED': {
      const parsed = parseJoint2dWire(data);
      if (!parsed) return true;
      useEditorStore.getState().applyJoint2dFromEngine(parsed.entityId, parsed.data);
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

    /*
     * Two 2D events the engine emits and nothing here handles yet. They are
     * listed rather than stubbed because a `case` for an event name the engine
     * never emits is indistinguishable from a working handler — that is exactly
     * how `PHYSICS2D_UPDATED`, `JOINT2D_UPDATED`, `PHYSICS2D_REMOVED` and
     * `RAYCAST2D_RESULT` sat here looking handled while the engine emitted
     * `PHYSICS2D_CHANGED`, `JOINT2D_CHANGED` and `RAYCAST2D_HIT`/`RAYCAST2D_MISS`,
     * and no removal event at all. Falling through to `default` at least returns
     * `false`, which `useEngineEvents` reports as unhandled.
     *
     * - `RAYCAST2D_HIT` / `RAYCAST2D_MISS` have no consumer at all — the 3D
     *   equivalent feeds audio occlusion and the script runtime; neither has a 2D
     *   counterpart yet.
     */

    default:
      return false;
  }
}
