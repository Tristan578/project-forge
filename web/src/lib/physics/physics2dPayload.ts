/**
 * The one place the browser's 2D-physics vocabulary and the engine's wire format meet.
 *
 * Three separate vocabularies are in play, and every one of them was mismatched
 * before PF-1167:
 *
 * 1. **The store / chat vocabulary** (`Physics2dData` in `stores/slices/types.ts`):
 *    camelCase keys, lowercase enum values (`'static'`, `'convex_polygon'`).
 * 2. **The outbound command wire** (`Physics2dPatch` in `engine/src/core/physics_2d.rs`):
 *    camelCase keys — but `set_physics2d` nests them under a `physicsData` object,
 *    while `update_physics2d` flattens them next to `entityId`. Sending the flat
 *    shape to `set_physics2d` is a hard serde reject, and `dispatchCommand` returns
 *    `void`, so it produced no signal anywhere.
 * 3. **The inbound event wire** (`emit_physics2d_changed` in `bridge/events.rs`):
 *    a camelCase wrapper (`entityId`, `enabled`) with the data struct FLATTENED into
 *    it — and `rename_all` does not propagate into a flattened struct, so those keys
 *    arrive snake_case with PascalCase enum values (`body_type: 'Static'`).
 *
 * Payloads are built by picking from an allowlist rather than by spreading and
 * annotating: `{ ...input } satisfies T` is inert, because TypeScript's
 * excess-property check never applies to properties introduced by a spread.
 *
 * This module must stay free of `@/stores` and `@/hooks` value imports — a value
 * import of either breaks `next build` from any API route that reaches this file.
 */

import type { Joint2dData, Physics2dData } from '@/stores/slices/types';

/**
 * The fields the engine's `Physics2dPatch` carries, as an OBJECT so the
 * `satisfies` check is bidirectional: an invalid key fails the excess-property
 * check, and an omitted key fails the missing-property check. An array with
 * `as const satisfies readonly (keyof T)[]` would only prove the keys are valid,
 * never that the list is complete.
 *
 * Pinned against the Rust struct by `__tests__/physics2dPayload.test.ts`.
 */
const PHYSICS2D_PATCH_FIELDS = {
  bodyType: true,
  colliderShape: true,
  size: true,
  radius: true,
  vertices: true,
  mass: true,
  friction: true,
  restitution: true,
  gravityScale: true,
  isSensor: true,
  lockRotation: true,
  continuousDetection: true,
  oneWayPlatform: true,
  surfaceVelocity: true,
} satisfies Record<keyof Physics2dData, true>;

export const PHYSICS2D_PATCH_KEYS = Object.keys(
  PHYSICS2D_PATCH_FIELDS,
) as (keyof Physics2dData)[];

/**
 * The engine's `Physics2dData::default()`, mirrored for the browser.
 *
 * A factory rather than a shared constant because two of the fields are arrays:
 * handing out one frozen object would either be mutable shared state or throw on
 * a caller that writes into `size`.
 *
 * This is a hand-mirrored copy of engine state, which is exactly the shape that
 * drifted silently for `ENGINE_CAMERA_DEFAULTS` (PF-1126), so
 * `__tests__/physics2dPayload.test.ts` reads the `impl Default for Physics2dData`
 * block out of `engine/src/core/physics_2d.rs` and fails on any disagreement.
 * Callers that need "the state of an entity with no physics configured yet" must
 * use this rather than writing a fourth copy of the table.
 */
export function defaultPhysics2dData(): Physics2dData {
  return {
    bodyType: 'dynamic',
    colliderShape: 'box',
    size: [1, 1],
    radius: 0.5,
    vertices: [],
    mass: 1,
    friction: 0.5,
    restitution: 0,
    gravityScale: 1,
    isSensor: false,
    lockRotation: false,
    continuousDetection: false,
    oneWayPlatform: false,
    surfaceVelocity: [0, 0],
  };
}

/** Flat patch payload — the shape `update_physics2d` deserializes. */
export type UpdatePhysics2dPayload = { entityId: string } & Partial<Physics2dData>;

/**
 * Nested payload — the shape `set_physics2d` deserializes.
 *
 * `enabled` is optional on the engine side and means "leave the current enabled
 * state alone" when omitted, so callers that only want to reconfigure a collider
 * must not send it.
 */
export interface SetPhysics2dPayload {
  entityId: string;
  physicsData: Partial<Physics2dData>;
  enabled?: boolean;
}

/**
 * Pick the allowlisted fields the caller actually set.
 *
 * `Object.hasOwn`, not a bare read: `patch[key]` walks the prototype chain, so a
 * caller passing a `Record` keyed by untrusted input could forward an inherited
 * value it never set.
 */
function pickPatchFields(patch: Partial<Physics2dData>): Partial<Physics2dData> {
  const picked: Partial<Physics2dData> = {};
  for (const key of PHYSICS2D_PATCH_KEYS) {
    if (!Object.hasOwn(patch, key)) continue;
    const value = patch[key];
    if (value !== undefined) {
      (picked as Record<string, unknown>)[key] = value;
    }
  }
  return picked;
}

/**
 * Build the `update_physics2d` payload: a flat partial patch.
 *
 * Any field omitted here is left untouched on the entity.
 */
export function buildUpdatePhysics2dPayload(
  entityId: string,
  patch: Partial<Physics2dData>,
): UpdatePhysics2dPayload {
  return { entityId, ...pickPatchFields(patch) };
}

/**
 * Build the `set_physics2d` payload: the patch nested under `physicsData`.
 *
 * `set_physics2d` is a FULL REPLACE — the engine applies this patch onto
 * `Physics2dData::default()`, so an omitted field resets to its default rather
 * than being left alone. That is the documented difference from
 * `update_physics2d`, and it is why the store's "the user edited one slider"
 * path must use the update builder, not this one.
 *
 * `enabled` is only emitted when the caller passes a boolean, so `undefined`
 * cannot be mistaken for "disable".
 */
export function buildSetPhysics2dPayload(
  entityId: string,
  data: Partial<Physics2dData>,
  enabled?: boolean,
): SetPhysics2dPayload {
  const payload: SetPhysics2dPayload = {
    entityId,
    physicsData: pickPatchFields(data),
  };
  if (typeof enabled === 'boolean') {
    payload.enabled = enabled;
  }
  return payload;
}

/**
 * The engine's snake_case wire key for each store field, for the inbound
 * `PHYSICS2D_CHANGED` event. Derived from the Rust field names, not from a
 * mechanical camel→snake transform, because `convex_polygon`-style names do not
 * round-trip through one.
 *
 * The `satisfies` below constrains the KEY set only — the values are unconstrained
 * `string`, so a wrong or stale snake_case spelling type-checks cleanly and then
 * silently reads `undefined`. The compiler cannot catch that; the guard is
 * `__tests__/physics2dPayload.test.ts`, which parses the Rust struct's field names
 * and asserts every one of them round-trips through `parsePhysics2dWire`.
 */
const WIRE_KEY_BY_FIELD = {
  bodyType: 'body_type',
  colliderShape: 'collider_shape',
  size: 'size',
  radius: 'radius',
  vertices: 'vertices',
  mass: 'mass',
  friction: 'friction',
  restitution: 'restitution',
  gravityScale: 'gravity_scale',
  isSensor: 'is_sensor',
  lockRotation: 'lock_rotation',
  continuousDetection: 'continuous_detection',
  oneWayPlatform: 'one_way_platform',
  surfaceVelocity: 'surface_velocity',
} satisfies Record<keyof Physics2dData, string>;

/**
 * The enum fields, whose values arrive as serde's PascalCase variant names.
 *
 * Lowercasing is not enough: `convex_polygon` serializes as `ConvexPolygon`, so
 * the mapping is explicit per variant. An unrecognised variant yields `undefined`
 * and the field is dropped rather than written as a value no consumer can match.
 */
const BODY_TYPE_BY_VARIANT: Record<string, Physics2dData['bodyType']> = {
  Dynamic: 'dynamic',
  Static: 'static',
  Kinematic: 'kinematic',
};

const COLLIDER_SHAPE_BY_VARIANT: Record<string, Physics2dData['colliderShape']> = {
  Box: 'box',
  Circle: 'circle',
  Capsule: 'capsule',
  ConvexPolygon: 'convex_polygon',
  Edge: 'edge',
  Auto: 'auto',
};

/**
 * Look a serde variant name up in one of the tables above.
 *
 * A bare `TABLE[raw]` walks the prototype chain, so `'constructor'`, `'toString'`
 * and `'__proto__'` all resolve to inherited members — every one of them truthy,
 * which means the `if (mapped)` guard passes and a `Function` or `Object.prototype`
 * lands where a `Physics2dData` enum value is declared. `Object.hasOwn` is the
 * same discipline the wire-key read above already uses (PF-1167).
 */
function variantValue<T>(table: Record<string, T>, raw: unknown): T | undefined {
  if (typeof raw !== 'string') return undefined;
  return Object.hasOwn(table, raw) ? table[raw] : undefined;
}

export interface ParsedPhysics2dWire {
  entityId: string;
  enabled: boolean;
  data: Partial<Physics2dData>;
}

/**
 * Parse a `PHYSICS2D_CHANGED` event payload into store vocabulary.
 *
 * Returns `null` for anything without a usable `entityId`, so a malformed event
 * cannot write physics state onto an entity the engine never named. Every other
 * field is best-effort: a missing or unrecognised value is dropped, never
 * defaulted, because a default here would look identical to the engine reporting
 * that value.
 */
export function parsePhysics2dWire(payload: unknown): ParsedPhysics2dWire | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const wire = payload as Record<string, unknown>;

  const entityId = wire.entityId;
  if (typeof entityId !== 'string' || entityId.length === 0) return null;

  const data: Partial<Physics2dData> = {};
  for (const field of PHYSICS2D_PATCH_KEYS) {
    const wireKey = WIRE_KEY_BY_FIELD[field];
    if (!Object.hasOwn(wire, wireKey)) continue;
    const raw = wire[wireKey];
    if (raw === undefined || raw === null) continue;

    if (field === 'bodyType') {
      const mapped = variantValue(BODY_TYPE_BY_VARIANT, raw);
      if (mapped) data.bodyType = mapped;
      continue;
    }
    if (field === 'colliderShape') {
      const mapped = variantValue(COLLIDER_SHAPE_BY_VARIANT, raw);
      if (mapped) data.colliderShape = mapped;
      continue;
    }
    (data as Record<string, unknown>)[field] = raw;
  }

  return {
    entityId,
    enabled: wire.enabled === true,
    data,
  };
}

/* ------------------------------------------------------------------------- *
 * 2D joints
 *
 * `set_joint_2d` was a hard serde reject on three independent axes at once: the
 * store spread the joint's fields FLAT next to `entityId` while the handler
 * expected them nested under `jointData`; the store speaks camelCase while
 * `PhysicsJoint2d` carries no `rename_all`; and `JointType2d` is an enum of
 * struct variants with no `#[serde(tag)]`, so it is externally tagged and can
 * only read `{"Revolute": {…}}` — never the bare `'revolute'` the store sends.
 * The engine now reads one flat camelCase vocabulary through
 * `PhysicsJoint2d::from_flat` and emits the same one through `to_flat`, and this
 * is the browser end of it.
 * ------------------------------------------------------------------------- */

/** The four joint types, as an object so membership is a `hasOwn` check. */
const JOINT2D_TYPES = {
  revolute: true,
  prismatic: true,
  rope: true,
  spring: true,
} satisfies Record<Joint2dData['jointType'], true>;

/**
 * The optional parameters each variant carries, keyed by joint type.
 *
 * Scoped per variant rather than sent as one flat union: `JointType2d::from_flat`
 * reads only the keys its own arm names, so a `maxDistance` riding along with a
 * spring joint would be silently ignored — the same "looks sent, never applied"
 * shape this module exists to close. Sending only what the variant can use keeps
 * the payload and the behaviour identical.
 */
/**
 * Which optional parameters each variant actually reads.
 *
 * Exported so its test can pin it against `JointType2d::from_flat` in
 * `engine/src/core/physics_2d.rs`. A key sent to the wrong variant is not an
 * error there — `from_flat` reads only the keys its own arm names, so a stray
 * one is silently ignored, which is the same "looks sent, never applied" shape
 * this module exists to prevent.
 */
export const JOINT2D_PARAMS_BY_TYPE = {
  revolute: ['limits', 'motorVelocity', 'motorMaxForce'],
  prismatic: ['axis', 'limits', 'motorVelocity', 'motorMaxForce'],
  rope: ['maxDistance'],
  spring: ['restLength', 'stiffness', 'damping'],
} as const satisfies Record<Joint2dData['jointType'], readonly (keyof Joint2dData)[]>;

/** Fields every joint carries regardless of type. */
const JOINT2D_COMMON_KEYS = ['targetEntityId', 'jointType', 'localAnchor1', 'localAnchor2'] as const;

function isJoint2dType(raw: unknown): raw is Joint2dData['jointType'] {
  return typeof raw === 'string' && Object.hasOwn(JOINT2D_TYPES, raw);
}

/**
 * Build the payload `set_joint_2d` / `create_2d_joint` / `update_2d_joint` read.
 *
 * Picked key by key from an allowlist, never spread: `{ entityId, ...data }` is
 * what shipped before, and it carried whatever the caller happened to hold —
 * TypeScript's excess-property check does not apply to spread properties, so an
 * invented key type-checks and then vanishes inside serde.
 *
 * Values are forwarded as-is rather than range-checked here. The engine rejects a
 * non-finite or wrong-shaped value by NAME and `reportCommandRejected` surfaces
 * that, so a second validator on this side could only disagree with the first —
 * and a value dropped here would be indistinguishable from one never sent.
 */
export function buildSetJoint2dPayload(
  entityId: string,
  data: Joint2dData,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { entityId };
  for (const key of JOINT2D_COMMON_KEYS) {
    payload[key] = data[key];
  }
  if (!isJoint2dType(data.jointType)) return payload;
  for (const key of JOINT2D_PARAMS_BY_TYPE[data.jointType]) {
    if (!Object.hasOwn(data, key)) continue;
    const value = data[key];
    if (value === undefined) continue;
    payload[key] = value;
  }
  return payload;
}

export interface ParsedJoint2dWire {
  entityId: string;
  data: Joint2dData;
}

/** Read a `[number, number]` out of a wire value, rejecting anything else. */
function wirePair(raw: unknown): [number, number] | undefined {
  // Indexed rather than `.every`, which skips array holes and would report a
  // gapped array as valid — see the fail-open-validator gotcha (PF-1143).
  if (!Array.isArray(raw) || raw.length !== 2) return undefined;
  const first = raw[0];
  const second = raw[1];
  if (typeof first !== 'number' || !Number.isFinite(first)) return undefined;
  if (typeof second !== 'number' || !Number.isFinite(second)) return undefined;
  return [first, second];
}

function wireNumber(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

/**
 * Parse a `JOINT2D_CHANGED` payload into store vocabulary.
 *
 * Returns `null` for anything without a usable `entityId`, `targetEntityId` and
 * known `jointType`, so a malformed event cannot write a half-built joint that
 * the inspector would then send back at the engine as if the user had authored
 * it. Anchors fall back to the engine's own `[0, 0]` default because they are
 * required by the type; optional parameters are dropped when absent or
 * unusable, never defaulted, since a default is indistinguishable from the
 * engine reporting that value.
 */
export function parseJoint2dWire(payload: unknown): ParsedJoint2dWire | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const wire = payload as Record<string, unknown>;

  const entityId = wire.entityId;
  if (typeof entityId !== 'string' || entityId.length === 0) return null;

  const targetEntityId = wire.targetEntityId;
  if (typeof targetEntityId !== 'string' || targetEntityId.length === 0) return null;

  const jointType = wire.jointType;
  if (!isJoint2dType(jointType)) return null;

  const data: Joint2dData = {
    targetEntityId,
    jointType,
    localAnchor1: wirePair(wire.localAnchor1) ?? [0, 0],
    localAnchor2: wirePair(wire.localAnchor2) ?? [0, 0],
  };

  for (const key of JOINT2D_PARAMS_BY_TYPE[jointType]) {
    if (!Object.hasOwn(wire, key)) continue;
    const raw = wire[key];
    if (key === 'limits' || key === 'axis') {
      const pair = wirePair(raw);
      if (pair) data[key] = pair;
      continue;
    }
    const num = wireNumber(raw);
    if (num !== undefined) data[key] = num;
  }

  return { entityId, data };
}
