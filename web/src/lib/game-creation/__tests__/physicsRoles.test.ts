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

  it('gives the player the only dynamic, rotation-locked body', () => {
    // Rapier's default `ActiveCollisionTypes` is DYNAMIC_*, so every pair the
    // player forms needs the player to be the dynamic side; a free-rotating
    // capsule tips over on first contact and the player rolls on its side.
    expect(PHYSICS_ROLE_PROFILES.player.bodyType).toBe('dynamic');
    expect(PHYSICS_ROLE_PROFILES.player.lockRotation).toBe(true);
    expect(PHYSICS_ROLE_PROFILES.player.isSensor).toBe(false);

    // Anything the player walks into and must not shove is fixed, and anything
    // it should pass through while still registering the touch is a sensor.
    expect(PHYSICS_ROLE_PROFILES.geometry).toEqual({
      bodyType: 'fixed', colliderShape: 'cuboid', isSensor: false, lockRotation: false,
    });
    expect(PHYSICS_ROLE_PROFILES.interactable.isSensor).toBe(true);
    expect(PHYSICS_ROLE_PROFILES.trigger.isSensor).toBe(true);
  });
});
