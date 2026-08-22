/**
 * Event handlers for physics, joints, physics2d, collisions, raycasts.
 */

import { useEditorStore, type PhysicsData, type JointData } from '@/stores/editorStore';
import { getScriptCollisionCallback } from '@/lib/scripting/useScriptRunner';
import { audioManager } from '@/lib/audio/audioManager';
import { parseJoint2dWire, parsePhysics2dWire } from '@/lib/physics/physics2dPayload';
import { castPayload, type SetFn, type GetFn, type EventPayload } from './types';

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

const JOINT_TYPES: readonly JointData['jointType'][] = [
  'fixed',
  'revolute',
  'spherical',
  'prismatic',
  'rope',
  'spring',
];

function isJointType(value: unknown): value is JointData['jointType'] {
  return (
    typeof value === 'string' && (JOINT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Read a `[f32; 3]` off the wire.
 *
 * Indexed, NOT `.every`: a callback form is never invoked for an array hole, so
 * `[1, , 3].every(Number.isFinite)` is `true` and the guard would narrow to a
 * tuple type promising a slot that is not there.
 */
function wireTriple(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const out: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const n = value[i];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    out.push(n);
  }
  return [out[0], out[1], out[2]];
}

/** `Option<JointLimits>` — absent, null and malformed all mean "no limits". */
function wireLimits(value: unknown): JointData['limits'] {
  if (typeof value !== 'object' || value === null) return null;
  const { min, max } = value as Record<string, unknown>;
  if (typeof min !== 'number' || !Number.isFinite(min)) return null;
  if (typeof max !== 'number' || !Number.isFinite(max)) return null;
  return { min, max };
}

/** `Option<JointMotor>` — absent, null and malformed all mean "no motor". */
function wireMotor(value: unknown): JointData['motor'] {
  if (typeof value !== 'object' || value === null) return null;
  const { targetVelocity, maxForce } = value as Record<string, unknown>;
  if (typeof targetVelocity !== 'number' || !Number.isFinite(targetVelocity)) return null;
  if (typeof maxForce !== 'number' || !Number.isFinite(maxForce)) return null;
  return { targetVelocity, maxForce };
}

/**
 * Parse one entry of the 3D `QUERY_JOINTS_LIST` answer.
 *
 * `process_joint_queries` serializes a local `JointInfo` that FLATTENS
 * `JointData` next to `entity_id`, and both carry `rename_all = "camelCase"`,
 * so the wire is `{ entityId, jointType, connectedEntityId, anchorSelf,
 * anchorOther, axis, limits, motor }`. Parsed rather than cast: a cast
 * type-checks and is wrong at runtime, which is how the emitted game-component
 * shape reached the inspector as `undefined` fields (PF-1141).
 */
function parseJointWire(payload: unknown): { entityId: string; data: JointData } | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const wire = payload as Record<string, unknown>;

  const entityId = wire.entityId;
  if (typeof entityId !== 'string' || entityId.length === 0) return null;

  const connectedEntityId = wire.connectedEntityId;
  if (typeof connectedEntityId !== 'string') return null;

  const jointType = wire.jointType;
  if (!isJointType(jointType)) return null;

  const anchorSelf = wireTriple(wire.anchorSelf);
  const anchorOther = wireTriple(wire.anchorOther);
  const axis = wireTriple(wire.axis);
  if (!anchorSelf || !anchorOther || !axis) return null;

  return {
    entityId,
    data: {
      jointType,
      connectedEntityId,
      anchorSelf,
      anchorOther,
      axis,
      limits: wireLimits(wire.limits),
      motor: wireMotor(wire.motor),
    },
  };
}

/**
 * Route the 3D joint list into the one piece of 3D joint state the store has.
 *
 * `physicsSlice` keeps `primaryJoint` only — there is no per-entity 3D joint
 * record — so the list is filtered down to the selected entity rather than
 * mirrored wholesale into a map nothing reads.
 *
 * The list is the scene's complete set of jointed entities, so a selection that
 * does NOT appear in it genuinely has no joint: writing `null` there is what
 * stops a previously-shown joint from lingering in the inspector. With no
 * selection there is no reader at all, and the answer is dropped.
 *
 * Routes to `setPrimaryJoint`, the state-only action `JOINT_CHANGED` already
 * uses; the dispatching siblings would send a command straight back at the
 * engine that just reported the joint.
 */
function applyJointList(entries: readonly unknown[]): void {
  const primaryId = useEditorStore.getState().primaryId;
  if (!primaryId) return;

  let selected: JointData | null = null;
  for (const entry of Array.from(entries)) {
    const parsed = parseJointWire(entry);
    if (!parsed || parsed.entityId !== primaryId) continue;
    selected = parsed.data;
    break;
  }
  useEditorStore.getState().setPrimaryJoint(selected);
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
  data: EventPayload,
  _set: SetFn,
  _get: GetFn
): boolean {
  /**
   * The list-query answers are the only physics payloads that are JSON arrays,
   * and they are handled before the switch so every case below reads a plain
   * object. Narrowing here rather than inside a case is what keeps the
   * `castPayload` calls honest: an array reaching one of them would be cast
   * into a shape it cannot have, with no runtime complaint.
   *
   * `QUERY_JOINTS2D_LIST` is the reply channel for `list_joints_2d`, which
   * answered `Not yet implemented` for its whole life — 2D joint state had no
   * read path at all while the 3D surface had two (PF-1194). Each entry is the
   * same flat vocabulary `JOINT2D_CHANGED` carries with `entityId` folded in,
   * so both answers share one parser rather than growing a third joint wire
   * shape.
   *
   * `QUERY_JOINTS_LIST` is the 3D counterpart. It was emitted by
   * `process_joint_queries` with no browser listener at all for its whole life
   * — the inbound half of the dead-vocabulary class, and the mirror image of
   * the `PHYSICS2D_UPDATED` phantoms below: an emitted name nothing listens for
   * looks identical to a scene that simply has no joints.
   *
   * `Array.from` first: `JSON.stringify` writes a hole as `null` and
   * `for...of` yields `undefined` for one rather than skipping it, so an
   * unreadable slot has to be tolerated either way — materializing makes that
   * explicit instead of leaving it to the iteration form.
   */
  if (Array.isArray(data)) {
    if (type === 'QUERY_JOINTS2D_LIST') {
      for (const entry of Array.from(data)) {
        const parsed = parseJoint2dWire(entry);
        if (!parsed) continue;
        useEditorStore.getState().applyJoint2dFromEngine(parsed.entityId, parsed.data);
      }
      return true;
    }
    if (type === 'QUERY_JOINTS_LIST') {
      applyJointList(data);
      return true;
    }
    return false;
  }

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

    /**
     * Reached only when the payload is NOT an array — the list itself is
     * handled above. A malformed answer is swallowed rather than reported
     * unhandled: the name is this handler's, so passing it on would make the
     * hub log it as an unknown engine event.
     */
    case 'QUERY_JOINTS2D_LIST':
    case 'QUERY_JOINTS_LIST':
      return true;

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
