/**
 * The physics role vocabulary must not drift from the GDD role vocabulary
 * (PF-1213).
 *
 * `planBuilder` decides which spawned entities get a `physics_enable` entry by
 * asking `physicsProfileForRole`, and a role it does not recognize is dropped
 * with a bare `continue` — no plan warning, no step warning, nothing. Entities
 * with that role then spawn with no `PhysicsEnabled`, so `manage_physics_lifecycle`
 * never gives them a Rapier collider, `runtime.active_collisions` never names
 * them, and the player walks straight through them. That is the whole defect
 * this ticket exists to fix, and adding one role to the GDD schema is enough to
 * reintroduce it.
 *
 * The union is derived (`PhysicsRole` is built from `EntityRole`), so the first
 * line of defence is the compiler: `PHYSICS_ROLE_PROFILES` is a `Record` over
 * that union and an unhandled role fails `tsc`. This file is the second line,
 * and it is not redundant — it holds at RUNTIME against `zEntityRole.options`,
 * the list the LLM's output is actually validated against, so it still fires if
 * the union is ever widened back to `string` or the two lists are ever
 * re-separated.
 *
 * Verified by mutation: add a role to `ENTITY_ROLES` without touching
 * `PHYSICS_ROLE_PROFILES` and the first test below goes red (as does `tsc`).
 */

import { describe, it, expect } from 'vitest';
import { ENTITY_ROLES, zEntityRole } from '../types';
import {
  ENABLEABLE_ROLES,
  PHYSICS_ROLES,
  PHYSICS_ROLE_PROFILES,
  physicsProfileForRole,
  type PhysicsBodyProfile,
} from '../physicsRoles';

/**
 * The one role the GDD emits that deliberately gets no body: the generator
 * files the camera rig and the key light under it, and a collider on those
 * drops an invisible one-metre wall at the origin of every generated game.
 */
const DOCUMENTED_BODYLESS_ROLES: readonly string[] = ['decoration'];

describe('physics role vocabulary (PF-1213)', () => {
  it('has a decision for every role the GDD schema can produce', () => {
    const options = zEntityRole.options;

    // Fail closed: an empty or truncated options list would make every
    // assertion below pass vacuously.
    expect(options.length).toBe(ENTITY_ROLES.length);
    expect(options.length).toBeGreaterThan(5);

    // Indexed loop, not `.forEach`/`.every`: a callback form skips an array
    // hole outright, so a gap in the vocabulary would report itself covered —
    // the same fail-open shape as the bug under test.
    for (let i = 0; i < options.length; i += 1) {
      const role = options[i];
      const profile = physicsProfileForRole(role);
      const bodyless = DOCUMENTED_BODYLESS_ROLES.includes(role);

      expect(
        Boolean(profile) !== bodyless,
        `GDD role "${role}" has no physics decision: give it a PHYSICS_ROLE_PROFILES `
        + 'entry, or add it to DOCUMENTED_BODYLESS_ROLES here with a reason. '
        + 'Without one, planBuilder drops every entity with this role from the '
        + 'physics_enable step and nothing in the game collides with them.',
      ).toBe(true);
    }
  });

  it('keeps the Zod enum and the exported tuple as one list, not two', () => {
    // `zEntityRole` is built FROM `ENTITY_ROLES`, so this is a guard against a
    // future edit re-separating them rather than a property of today's code.
    expect([...zEntityRole.options]).toEqual([...ENTITY_ROLES]);
  });

  it('lets a physics_enable step name every GDD role plus geometry', () => {
    // Wider than PHYSICS_ROLES on purpose: a plan carries the whole cast and
    // this module decides who gets a body, so `decoration` must be nameable and
    // then skipped. A role the schema can produce but a step may not name would
    // make `planBuilder` emit a step its own executor refuses.
    expect([...ENABLEABLE_ROLES]).toEqual([...ENTITY_ROLES, 'geometry']);

    for (let i = 0; i < PHYSICS_ROLES.length; i += 1) {
      expect(
        ENABLEABLE_ROLES as readonly string[],
        `role "${PHYSICS_ROLES[i]}" has a body profile but no step may name it`,
      ).toContain(PHYSICS_ROLES[i]);
    }
  });

  it('derives PHYSICS_ROLES from the profile table rather than restating it', () => {
    expect([...PHYSICS_ROLES]).toEqual(Object.keys(PHYSICS_ROLE_PROFILES));
    expect(PHYSICS_ROLES.length).toBeGreaterThan(5);

    for (let i = 0; i < DOCUMENTED_BODYLESS_ROLES.length; i += 1) {
      expect(PHYSICS_ROLES as readonly string[]).not.toContain(DOCUMENTED_BODYLESS_ROLES[i]);
    }
  });

  it('refuses a role it does not know instead of guessing a body', () => {
    // A hallucinated role, a typo, and the two prototype names a bare
    // `TABLE[role]` read would resolve to a function on `Object.prototype`.
    for (const role of ['boss', 'plyaer', '', 'decoration', '__proto__', 'constructor', 'toString']) {
      expect(physicsProfileForRole(role), `"${role}" was given a body`).toBeUndefined();
    }
  });

  /**
   * Every profile, in full, one case per role.
   *
   * Spot-checking a field or two per role is what let `enemy`, `npc` and
   * `projectile` go unasserted entirely: a `bodyType` flip on `enemy` turns a
   * chaser into a solid dynamic body that shoves the player off the level, and
   * nothing about that reads as a test failure anywhere else in the suite —
   * the game still builds, still plays, and is simply unwinnable.
   *
   * `toEqual` on the whole object, not `objectContaining`: an INVENTED field is
   * as dangerous as a wrong one here, because `buildPhysicsPatch` forwards only
   * keys the engine knows and drops the rest without a word.
   */
  const EXPECTED_PROFILES: Record<string, PhysicsBodyProfile> = {
    // Dynamic so every pair it forms carries the dynamic side Rapier's default
    // `ActiveCollisionTypes` requires; rotation-locked so a capsule does not tip
    // over on first contact and leave the player rolling on its side.
    player: { bodyType: 'dynamic', isSensor: false, lockRotation: true },

    // Moved by `system_follower`, which writes the transform directly — a
    // dynamic body would fight that write and be shoved by every contact. Fixed
    // still forms a DYNAMIC_FIXED pair with the player, so contact damage and
    // dialogue triggers still fire.
    enemy: { bodyType: 'fixed', isSensor: true, lockRotation: false },
    npc: { bodyType: 'fixed', isSensor: true, lockRotation: false },

    // Registers the touch without stopping the player dead or punting the
    // pickup across the arena.
    interactable: { bodyType: 'fixed', isSensor: true, lockRotation: false },
    trigger: { bodyType: 'fixed', isSensor: true, lockRotation: false },

    // Solid and free to tumble; `ball` matches the sphere mesh regardless of
    // the shape the entity happened to be spawned as.
    projectile: { bodyType: 'dynamic', colliderShape: 'ball', isSensor: false, lockRotation: false },

    // The thing that stops the player falling through the void.
    geometry: { bodyType: 'fixed', colliderShape: 'cuboid', isSensor: false, lockRotation: false },
  };

  it('expects a profile for every role the table defines', () => {
    // Keeps the table above honest in both directions: a role added to
    // `PHYSICS_ROLE_PROFILES` with no expectation here would otherwise be
    // "covered" by a loop that never visits it.
    expect(Object.keys(EXPECTED_PROFILES).sort()).toEqual([...PHYSICS_ROLES].sort());
  });

  it.each(Object.keys(EXPECTED_PROFILES))('pins the whole %s profile', role => {
    expect(PHYSICS_ROLE_PROFILES[role as keyof typeof PHYSICS_ROLE_PROFILES])
      .toEqual(EXPECTED_PROFILES[role]);
    // The same object reached through the lookup the pipeline actually calls —
    // a table that is right and a resolver that returns something else is a
    // distinction the executors would feel and this file would not.
    expect(physicsProfileForRole(role)).toEqual(EXPECTED_PROFILES[role]);
  });
});
