/**
 * What kind of physical body each pipeline-spawned entity gets (PF-1213).
 *
 * The engine attaches a Rapier collider only to an entity carrying
 * `PhysicsEnabled` (`manage_physics_lifecycle`, engine/src/core/physics.rs), and
 * `system_track_collisions` builds `runtime.active_collisions` purely from the
 * Rapier `CollisionEvent`s those colliders produce. So this table decides
 * whether a generated game can be won at all: no body, no collision pair, no
 * `system_collectible` pickup, no score, no `game_win`.
 *
 * Two engine facts pin the choices below and neither is obvious from the field
 * names:
 *
 *  1. **The player must be `dynamic`.** Rapier's default `ActiveCollisionTypes`
 *     is `DYNAMIC_DYNAMIC | DYNAMIC_KINEMATIC | DYNAMIC_FIXED`, and the engine
 *     never inserts a widened set. A KINEMATIC player against FIXED ground or a
 *     FIXED collectible produces NO events at all — the game would look right
 *     and still be unwinnable. Every pair below therefore has a dynamic side.
 *  2. **Anything the player walks into and must not shove is `fixed`.** A
 *     dynamic collectible would be batted across the level on contact, and a
 *     dynamic wall would fall over.
 *
 * Values are the engine's own serde spellings: `RigidBodyKind` is snake_case
 * (`dynamic`, `fixed`, `kinematic_position`, `kinematic_velocity`) and
 * `PhysicsData`'s fields are camelCase on the wire. Verified textually against
 * engine/src/core/physics.rs.
 *
 * THE ROLE VOCABULARY IS DERIVED, NEVER RESTATED. `EntityRole` comes from
 * `ENTITY_ROLES` in `./types`, the same tuple `zEntityRole` validates the GDD
 * generator's output against. A hand-written copy here would drift the moment a
 * role is added to the schema, and it would drift SILENTLY in the worst
 * direction: `planBuilder` skips any role this table does not know with a bare
 * `continue`, so those entities would spawn with no `PhysicsEnabled` and no
 * collider — the exact defect this module exists to fix, reintroduced by the fix
 * for it. Deriving makes it a compile error (`PHYSICS_ROLE_PROFILES` is a
 * `Record` over the derived union, so an unhandled role fails to type-check),
 * and `__tests__/physicsRoles.test.ts` pins it a second time at runtime against
 * `zEntityRole.options` in case the union is ever re-widened to `string`.
 *
 * Server-safe: no `@/stores` or `@/hooks` VALUE import (see `entityShape.ts`).
 */

import type { PhysicsData } from '@/stores/slices/types';
import { ENTITY_ROLES, type EntityRole } from './types';
import type { ColliderShapeName } from './entityShape';

/**
 * The blueprint roles that get a physical body, plus `geometry` — the role
 * `worldBuildExecutor`'s ground, platforms and walls are filed under, which the
 * GDD schema never emits because the world builder mints them itself.
 *
 * `decoration` is deliberately excluded, and that exclusion is not an oversight.
 * The GDD generator files the camera rig and the key light as `decoration`
 * entities, and those are spawned as real cubes. Giving them a static collider
 * would drop an invisible one-metre wall at the origin of every generated game.
 * A prop that genuinely needs to be solid is authored as world geometry.
 */
export type PhysicsRole = Exclude<EntityRole, 'decoration'> | 'geometry';

/**
 * The subset of `PhysicsData` the enablement step sets.
 *
 * Deliberately small. `toggle_physics` inserts `PhysicsData::default()`, so every
 * field left out here keeps the engine's own default — one copy of the number
 * rather than two that can drift. Mass/friction/restitution/gravity are the
 * `physics_profile` step's business and it runs after this one.
 */
export interface PhysicsBodyProfile {
  /**
   * Derived from `PhysicsData` rather than restated: the union is the mirror of
   * `RigidBodyKind` in engine/src/core/physics.rs, and a hand-written second
   * copy silently stops matching the engine the first time a variant moves.
   */
  bodyType: PhysicsData['bodyType'];
  /** Overrides the mesh-derived collider when the role demands a specific one. */
  colliderShape?: ColliderShapeName;
  isSensor: boolean;
  /**
   * A capsule with free rotation tips over the instant it touches the ground and
   * the player then rolls around on its side. Only the player is rigged this way
   * — a rolling projectile is the point of a projectile.
   */
  lockRotation?: boolean;
}

/**
 * `Record<PhysicsRole, …>` is the completeness proof: add a role to
 * `ENTITY_ROLES` and this object stops type-checking until it is handled here,
 * so a new role can never reach `planBuilder` without a decision about its body.
 */
export const PHYSICS_ROLE_PROFILES: Readonly<Record<PhysicsRole, PhysicsBodyProfile>> = {
  // Dynamic so every pair it forms carries the dynamic side Rapier's default
  // `ActiveCollisionTypes` requires; rotation-locked so it stays upright.
  player: { bodyType: 'dynamic', isSensor: false, lockRotation: true },

  // Chasers and NPCs are moved by `system_follower`, which writes the transform
  // directly each frame. A dynamic body would fight that write and get shoved by
  // contacts; a fixed one still forms a DYNAMIC_FIXED pair with the player, so
  // contact damage and dialogue triggers still fire.
  enemy: { bodyType: 'fixed', isSensor: true, lockRotation: false },
  npc: { bodyType: 'fixed', isSensor: true, lockRotation: false },

  // A pickup must register the touch WITHOUT stopping the player dead or
  // punting the crystal across the arena — that is exactly what a sensor is.
  // `manage_physics_lifecycle` inserts Rapier's `Sensor` when `is_sensor` is
  // set, and `ActiveEvents::COLLISION_EVENTS` regardless, so the pair still
  // reaches `runtime.active_collisions`.
  interactable: { bodyType: 'fixed', isSensor: true, lockRotation: false },
  trigger: { bodyType: 'fixed', isSensor: true, lockRotation: false },

  // Solid and free to tumble; the ball collider matches the sphere mesh a
  // projectile is spawned with.
  projectile: { bodyType: 'dynamic', colliderShape: 'ball', isSensor: false, lockRotation: false },

  // Ground, platforms and boundary walls. Solid and immovable — this is the
  // thing that stops the player falling through the void.
  geometry: { bodyType: 'fixed', colliderShape: 'cuboid', isSensor: false, lockRotation: false },
};

/**
 * The roles that get a body, read off the table itself rather than listed a
 * second time. `Object.keys` of a `Record<PhysicsRole, …>` IS the union.
 */
export const PHYSICS_ROLES: readonly PhysicsRole[] =
  Object.keys(PHYSICS_ROLE_PROFILES) as PhysicsRole[];

const PHYSICS_ROLE_SET: ReadonlySet<string> = new Set<string>(PHYSICS_ROLES);

/**
 * The profile for a blueprint role, or `undefined` when the role gets no body.
 *
 * Returning `undefined` rather than a default is the point: a role this table
 * does not know must be skipped loudly by the caller, never given a silent
 * cuboid it did not ask for.
 */
export function physicsProfileForRole(role: string): PhysicsBodyProfile | undefined {
  if (!PHYSICS_ROLE_SET.has(role)) return undefined;
  return PHYSICS_ROLE_PROFILES[role as PhysicsRole];
}

/**
 * Roles a `physics_enable` step is allowed to name.
 *
 * Wider than `PHYSICS_ROLES` on purpose, and derived rather than typed out: it
 * is every `ENTITY_ROLES` entry plus `geometry`, so a step may name a
 * `decoration` and have it SKIPPED — a plan that carries the whole cast and lets
 * this module decide who gets a body is the honest shape. A role in neither list
 * (a hallucinated `boss`, a typo) is refused outright by the executor's schema
 * rather than quietly given a cuboid it never asked for: a wrong body is a bug
 * that ships, a refused step is one that reports.
 *
 * A const tuple, so `z.enum(ENABLEABLE_ROLES)` infers the literal union with no
 * cast — a cast through `[string, ...string[]]` would have accepted a widened
 * `string[]` and silently stopped constraining anything.
 */
export const ENABLEABLE_ROLES = [...ENTITY_ROLES, 'geometry'] as const;

export type EnableableRole = (typeof ENABLEABLE_ROLES)[number];
