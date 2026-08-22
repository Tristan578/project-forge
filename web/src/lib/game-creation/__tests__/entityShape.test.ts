/**
 * The mesh-and-collider table (PF-1213).
 *
 * `entityShape.ts` decides two things that are only ever seen together at play
 * time: the primitive an entity is spawned as, and the Rapier collider that
 * mesh is given. When those disagree, nothing reports it — the mesh draws
 * correctly, the collider is real, and the only symptom is a player caught on
 * empty air or passing through something solid.
 *
 * The module was extracted from `entitySetupExecutor` in this branch precisely
 * because `physicsEnableExecutor` needed the same mapping, so it now has two
 * callers and no test of its own; `cylinder`, `cone` and `torus` reached no
 * assertion anywhere, because no executor fixture spawned one.
 */

import { describe, it, expect } from 'vitest';
import {
  SPAWNABLE_SHAPES,
  COLLIDER_FOR_SHAPE,
  ROLE_TO_ENTITY_TYPE,
  shapeFromAppearance,
  resolveEntityShape,
  type SpawnShape,
  type ColliderShapeName,
} from '../entityShape';

/**
 * Written out rather than read off `COLLIDER_FOR_SHAPE`, which would assert
 * only that the table equals itself.
 *
 * `make_collider` (engine/src/core/physics.rs) builds exactly four shapes plus
 * an `Auto` arm that falls back to a cuboid, so `plane`, `cone` and `torus`
 * take the cuboid deliberately — an approximation, and a better one than the
 * alternative of no collider at all.
 */
const EXPECTED_COLLIDERS: Record<SpawnShape, ColliderShapeName> = {
  cube: 'cuboid',
  sphere: 'ball',
  plane: 'cuboid',
  cylinder: 'cylinder',
  cone: 'cuboid',
  torus: 'cuboid',
  capsule: 'capsule',
};

describe('entityShape — collider mapping', () => {
  it.each(SPAWNABLE_SHAPES)('gives %s the collider that fits it', shape => {
    expect(COLLIDER_FOR_SHAPE[shape]).toBe(EXPECTED_COLLIDERS[shape]);
  });

  it('maps every spawnable shape and nothing else', () => {
    // A shape added to `SPAWNABLE_SHAPES` without a collider entry would give
    // `physicsEnableExecutor` an `undefined` lookup, which falls through to a
    // cuboid — silently wrong rather than loudly missing. `tsc` catches it via
    // the `Record`, and this holds the same line at runtime.
    expect(Object.keys(COLLIDER_FOR_SHAPE).sort()).toEqual([...SPAWNABLE_SHAPES].sort());
    // Also pins the expectations above as exhaustive: a shape added to the
    // module and to the table but not to this file would otherwise be "covered"
    // by an `it.each` that reads `undefined` from both sides and passes.
    expect(Object.keys(EXPECTED_COLLIDERS).sort()).toEqual([...SPAWNABLE_SHAPES].sort());
  });

  it('never emits the engine’s `auto` collider', () => {
    // `Auto` builds a cuboid anyway, so choosing it would change no behaviour —
    // but it would hide the pairing, and a wrong pairing is only ever caught by
    // reading the shape name next to the collider name in a diff.
    for (let i = 0; i < SPAWNABLE_SHAPES.length; i += 1) {
      expect(COLLIDER_FOR_SHAPE[SPAWNABLE_SHAPES[i]]).not.toBe('auto');
    }
  });
});

describe('entityShape — shapeFromAppearance', () => {
  it.each(SPAWNABLE_SHAPES)('honours an explicit primitive:%s', shape => {
    expect(shapeFromAppearance(`primitive:${shape}`)).toBe(shape);
  });

  it('tolerates the casing and padding an LLM actually emits', () => {
    expect(shapeFromAppearance('  primitive:Sphere  ')).toBe('sphere');
    expect(shapeFromAppearance('PRIMITIVE:CUBE')).toBe('cube');
  });

  it('keeps out of the way when the appearance is not a primitive it can spawn', () => {
    // The field is free text by contract. Returning undefined hands the
    // decision back to the role default instead of failing the step — a
    // generated game with a cube where a crystal was described still plays.
    const notShapes = [
      undefined,
      '',
      'a glowing crystal that pulses softly',
      'sprite:hero_idle',
      'primitive:dodecahedron', // a real-looking shape the engine cannot spawn
      'primitive:point_light',  // excluded on purpose: a body must not become a light
      'primitive:',
      'primitive:cube extra',
    ];
    for (let i = 0; i < notShapes.length; i += 1) {
      expect(shapeFromAppearance(notShapes[i]), `"${notShapes[i]}" was accepted`).toBeUndefined();
    }
  });
});

describe('entityShape — resolveEntityShape', () => {
  it('spawns every 2d entity as a plane, whatever the design asked for', () => {
    // A capsule in a 2D scene is not a style choice, it is a broken sprite. The
    // override is 3D-only, and the role default must not leak through either.
    expect(resolveEntityShape('player', 'primitive:capsule', '2d')).toBe('plane');
    expect(resolveEntityShape('projectile', undefined, '2d')).toBe('plane');
    expect(resolveEntityShape('nonsense', 'primitive:torus', '2d')).toBe('plane');
  });

  it('lets an explicit 3d appearance outrank the role default', () => {
    expect(ROLE_TO_ENTITY_TYPE.player).toBe('capsule');
    expect(resolveEntityShape('player', 'primitive:sphere', '3d')).toBe('sphere');
  });

  it('falls back to the role default, then to a cube', () => {
    expect(resolveEntityShape('player', 'a tall figure in a cloak', '3d')).toBe('capsule');
    expect(resolveEntityShape('projectile', undefined, '3d')).toBe('sphere');
    // A role no table knows — a hallucinated one, or one added to the GDD
    // schema and not here. A cube is the shape that is wrong in a bounded way.
    expect(resolveEntityShape('boss', undefined, '3d')).toBe('cube');
    expect(resolveEntityShape('', 'primitive:unknown', '3d')).toBe('cube');
  });

  it('reads role defaults with no prototype lookup', () => {
    // `ROLE_TO_ENTITY_TYPE[role]` is a plain-object read, so a role named for an
    // `Object.prototype` member would otherwise resolve to a function and be
    // spawned as one.
    for (const role of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(resolveEntityShape(role, undefined, '3d'), `"${role}" leaked`).toBe('cube');
    }
  });
});
