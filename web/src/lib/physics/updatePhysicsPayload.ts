/**
 * Wire contract for the engine's `update_physics` command.
 *
 * The engine deserializes this command into `PhysicsPatch` (engine/src/core/physics.rs):
 * the 13 `PhysicsData` fields, each `Option<T>`, under `#[serde(rename_all = "camelCase", default)]`.
 * Only the keys present in the payload are written; the rest keep their live
 * engine-side values.
 *
 * That all-`Option` shape is deliberate — a partial payload has to be legal, which
 * is the whole point of PF-1118 — but it means the engine cannot reject a typo.
 * `#[serde(deny_unknown_fields)]` is incompatible with the `#[serde(flatten)]`
 * that `UpdatePhysicsPayload` uses, so a misspelled `gravtiyScale` deserializes to
 * `None` and silently no-ops. This module is where that gap is closed instead.
 */

import type { PhysicsData } from '@/stores/slices/types';

/**
 * Every field the engine's `PhysicsPatch` accepts.
 *
 * The `satisfies Record<keyof PhysicsData, true>` is load-bearing in BOTH
 * directions: a key that is not on `PhysicsData` fails excess-property checking,
 * and a `PhysicsData` field missing from here fails the missing-property check.
 * So adding a field to the Rust `PhysicsData` (and mirroring it on the TypeScript
 * interface) breaks the build until it is listed here too.
 *
 * This is an object rather than an array because `as const satisfies readonly
 * (keyof PhysicsData)[]` only proves the keys are VALID — it cannot prove the
 * list is COMPLETE.
 */
const PHYSICS_PATCH_FIELDS = {
  bodyType: true,
  colliderShape: true,
  restitution: true,
  friction: true,
  density: true,
  gravityScale: true,
  lockTranslationX: true,
  lockTranslationY: true,
  lockTranslationZ: true,
  lockRotationX: true,
  lockRotationY: true,
  lockRotationZ: true,
  isSensor: true,
} satisfies Record<keyof PhysicsData, true>;

/** Runtime allowlist derived from {@link PHYSICS_PATCH_FIELDS}. */
export const PHYSICS_PATCH_KEYS = Object.keys(PHYSICS_PATCH_FIELDS) as (keyof PhysicsData)[];

/** The exact object shape `dispatchCommand('update_physics', …)` accepts. */
export type PhysicsPatchPayload = { entityId: string } & Partial<PhysicsData>;

/**
 * Build an `update_physics` payload containing ONLY allowlisted keys.
 *
 * Use this instead of spreading a caller-shaped object into the dispatch. A
 * `satisfies PhysicsPatchPayload` on a spread is inert — TypeScript's
 * excess-property (freshness) check applies to properties written literally, not
 * to properties introduced by a spread — so `{ entityId, ...input } satisfies
 * PhysicsPatchPayload` type-checks happily while carrying keys the engine will
 * drop on the floor. Annotating the variable instead is equally inert, for the
 * same reason. Picking is the only construction that actually constrains the
 * result.
 *
 * `undefined` values are omitted rather than serialized: `serde` maps an explicit
 * `null`/absent key to `None`, but emitting `"friction": undefined` through
 * `JSON.stringify` drops the key anyway, and omitting it here keeps the dispatched
 * object honest about what it is asking the engine to change.
 */
export function buildPhysicsPatch(
  entityId: string,
  patch: Partial<PhysicsData>,
): PhysicsPatchPayload {
  const payload: PhysicsPatchPayload = { entityId };
  for (const key of PHYSICS_PATCH_KEYS) {
    // `Object.hasOwn`, not a bare read: `patch[key]` walks the prototype chain, so
    // an object literal carrying a `__proto__:` key (or anything built on a
    // non-null prototype holding these names) would contribute values the caller
    // never actually set — dispatched to the engine as if they had.
    if (!Object.hasOwn(patch, key)) continue;
    const value = patch[key];
    if (value !== undefined) {
      // Index-assignment through a widened view: each `key` is a valid
      // `PhysicsData` key and `value` is that key's own value type, but
      // TypeScript cannot correlate the two across a loop.
      (payload as Record<string, unknown>)[key] = value;
    }
  }
  return payload;
}
