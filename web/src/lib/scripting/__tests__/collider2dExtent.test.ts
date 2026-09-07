/**
 * `collider2dHalfHeight` mirrors `make_collider_2d`
 * (`engine/src/core/physics_2d_sim.rs:58`), so this file's job is to pin every
 * arm of that match. A shape added to the Rust constructor and forgotten here
 * would make `isGrounded` cast from the wrong place for that shape only —
 * silently, and for whichever shape someone chose deliberately.
 */
import { describe, it, expect } from 'vitest';
import { collider2dHalfHeight, type Collider2dShape } from '../collider2dExtent';

/** `Physics2dData::default()` — size [1,1], radius 0.5 (physics_2d.rs:53). */
function shape(overrides: Partial<Collider2dShape> = {}): Collider2dShape {
  return {
    colliderShape: 'box',
    size: [1, 1],
    radius: 0.5,
    vertices: [],
    ...overrides,
  };
}

describe('collider2dHalfHeight', () => {
  // THE NUMBER THE WHOLE DEFECT TURNED ON. The default collider is 1 unit tall,
  // so its bottom is 0.5 below the transform origin — and the default ground
  // ray is 0.1 long. Casting from the origin, it stops 0.4 short of the
  // entity's own feet, which is why every ground check answered false.
  it('reaches 0.5 below the origin for the default 1x1 box', () => {
    expect(collider2dHalfHeight(shape(), 1)).toBe(0.5);
  });

  it('halves the box height, and treats auto as a box', () => {
    expect(collider2dHalfHeight(shape({ colliderShape: 'box', size: [2, 3] }), 1)).toBe(1.5);
    expect(collider2dHalfHeight(shape({ colliderShape: 'auto', size: [2, 3] }), 1)).toBe(1.5);
  });

  // `Collider::ball(radius)` uses the radius directly and ignores size, so a
  // circle whose size disagrees with its radius must follow the radius.
  it('uses the radius for a circle, not the size', () => {
    expect(collider2dHalfHeight(shape({ colliderShape: 'circle', radius: 0.75, size: [10, 10] }), 1))
      .toBe(0.75);
  });

  // `half_height = (size[1] * 0.5 - radius).max(0.0)`, and the capsule reaches
  // half_height + radius. For the ordinary case that is just size[1] * 0.5.
  it('reaches half the height for an ordinary capsule', () => {
    expect(collider2dHalfHeight(shape({ colliderShape: 'capsule', size: [1, 4], radius: 0.5 }), 1))
      .toBe(2);
  });

  // The `.max(0.0)` clamp is the interesting arm: a radius larger than the
  // half-height collapses the cylinder to nothing and leaves a ball, which
  // reaches the RADIUS — further than size[1] * 0.5. Returning size[1] * 0.5
  // here would put the ray origin inside the collider.
  it('follows the radius for a capsule whose radius exceeds its half-height', () => {
    expect(collider2dHalfHeight(shape({ colliderShape: 'capsule', size: [1, 1], radius: 2 }), 1))
      .toBe(2);
  });

  it('measures the lowest vertex of a convex polygon', () => {
    expect(collider2dHalfHeight(shape({
      colliderShape: 'convex_polygon',
      vertices: [[-1, 1], [1, 1], [0, -3]],
    }), 1)).toBe(3);
  });

  // Rust falls back to the box below three vertices, so this must too.
  it('falls back to the box for a polygon with too few vertices', () => {
    expect(collider2dHalfHeight(shape({
      colliderShape: 'convex_polygon',
      size: [1, 6],
      vertices: [[0, -3], [1, 1]],
    }), 1)).toBe(3);
  });

  // A polygon entirely above the origin reaches nothing below it.
  it('reaches nothing below the origin for a polygon that sits above it', () => {
    expect(collider2dHalfHeight(shape({
      colliderShape: 'convex_polygon',
      vertices: [[-1, 1], [1, 1], [0, 3]],
    }), 1)).toBe(0);
  });

  // `Collider::segment((-half_x, 0), (half_x, 0))` — horizontal, through the
  // origin. Its size[1] is meaningless and must not be read.
  it('reaches nothing below the origin for an edge, whatever its height says', () => {
    expect(collider2dHalfHeight(shape({ colliderShape: 'edge', size: [10, 10] }), 1)).toBe(0);
  });

  /**
   * A NaN here would reach the engine as the ray's origin and make the answer
   * meaningless rather than merely wrong — and `serde` would reject the payload,
   * so the cast would be refused and the slot abandoned on every frame.
   */
  it.each([
    ['a NaN height', shape({ size: [1, NaN] })],
    ['an infinite height', shape({ size: [1, Infinity] })],
    ['a NaN radius on a circle', shape({ colliderShape: 'circle', radius: NaN })],
    ['a missing size', shape({ size: undefined as unknown as [number, number] })],
    ['missing vertices', shape({ colliderShape: 'convex_polygon', size: [1, NaN], vertices: undefined as unknown as [number, number][] })],
  ])('returns a finite 0 for %s', (_label, input) => {
    const result = collider2dHalfHeight(input, 1);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBe(0);
  });

  // A negative size is not meaningful, but `Collider::cuboid` would take its
  // magnitude — so this follows rather than returning a negative offset that
  // would move the ray origin UP.
  it('takes the magnitude of a negative height rather than moving the origin up', () => {
    expect(collider2dHalfHeight(shape({ size: [1, -4] }), 1)).toBe(2);
  });

  /**
   * THE SCALE, which the first version of this module ignored entirely.
   *
   * bevy_rapier's `apply_scale` multiplies every collider by the entity's
   * `GlobalTransform` scale unless a `ColliderScale` component overrides it,
   * and this repo inserts none — so the simulated collider is never the one
   * `make_collider_2d` built unless the scale happens to be 1. Every shipped 2D
   * template uses non-unit scale, including a `[1, 2, 1]` enemy.
   *
   * Both directions are wrong without it, and each is wrong in its own way:
   *   scale > 1  the offset is too small, the ray stops short of the feet, and
   *              `isGrounded` is permanently false — the defect this file exists
   *              to fix, reached through the one multiplier it did not mirror.
   *   scale < 1  the offset is too big, the origin lands BELOW the feet inside
   *              the floor, and `cast_ray(solid: true)` answers `toi = 0` — so
   *              an airborne entity reads as grounded and a jump gate opens
   *              mid-air.
   */
  describe('the transform scale', () => {
    it('doubles the reach of a box scaled 2x, which is a shipped case', () => {
      expect(collider2dHalfHeight(shape(), 2)).toBe(1);
    });

    it('halves it below 1, which is also a shipped case', () => {
      expect(collider2dHalfHeight(shape(), 0.5)).toBe(0.25);
    });

    it('scales a circle by its radius', () => {
      expect(collider2dHalfHeight(shape({ colliderShape: 'circle', radius: 0.75 }), 2)).toBe(1.5);
    });

    it('scales both halves of a capsule, so the clamp still lands correctly', () => {
      // radius 2 exceeds half the height, so this is a ball of radius 2 —
      // scaled, a ball of radius 4. Scaling only the height would answer 1.
      expect(
        collider2dHalfHeight(shape({ colliderShape: 'capsule', size: [1, 1], radius: 2 }), 2),
      ).toBe(4);
    });

    it('scales the lowest vertex of a polygon', () => {
      expect(collider2dHalfHeight(shape({
        colliderShape: 'convex_polygon',
        vertices: [[-1, 1], [1, 1], [0, -3]],
      }), 2)).toBe(6);
    });

    it('leaves an edge at nothing, whatever it is scaled by', () => {
      expect(collider2dHalfHeight(shape({ colliderShape: 'edge' }), 5)).toBe(0);
    });

    // A collider scaled to nothing reaches nothing; the ray then starts at the
    // origin, which is where the entity is.
    it('reaches nothing at scale 0', () => {
      expect(collider2dHalfHeight(shape(), 0)).toBe(0);
    });

    // A negative scale mirrors the shape; its REACH is the magnitude. Returning
    // a negative offset would move the ray origin upward, away from the ground.
    it('takes the magnitude of a negative scale', () => {
      expect(collider2dHalfHeight(shape(), -2)).toBe(1);
    });

    it.each([
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['undefined', undefined as unknown as number],
    ])('treats a %s scale as no reach rather than propagating it', (_label, scaleY) => {
      const result = collider2dHalfHeight(shape(), scaleY);
      expect(Number.isFinite(result)).toBe(true);
      expect(result).toBe(0);
    });
  });

  /**
   * `Collider::convex_hull` returns `None` for input enclosing no area, and the
   * engine then falls back to the box. Three collinear points are the reachable
   * case; missing this arm puts the ray origin where the collider is not.
   */
  it('falls back to the box for a hull rapier would refuse to build', () => {
    expect(collider2dHalfHeight(shape({
      colliderShape: 'convex_polygon',
      size: [1, 6],
      // Collinear: no interior, so no hull.
      vertices: [[-1, -1], [0, 0], [1, 1]],
    }), 1)).toBe(3);
  });

  it('still measures a hull that does enclose an area', () => {
    expect(collider2dHalfHeight(shape({
      colliderShape: 'convex_polygon',
      size: [1, 6],
      vertices: [[-1, -1], [0, 0.5], [1, -1]],
    }), 1)).toBe(1);
  });

  /**
   * A RECORD, so TypeScript does the enforcing.
   *
   * The first version of this was an ARRAY literal of the six names plus
   * `expect(covered.length).toBe(6)`, and it could not fail for the drift it
   * claimed to catch: a seventh union member leaves that array a valid subtype,
   * leaves the length at 6, and falls through `default: return 0` without
   * throwing. It read as coverage of this module's stated risk while providing
   * none — lessons-learned #11, written by me in the same session that wrote
   * #11's own entry.
   *
   * A `Record<Collider2dShape['colliderShape'], number>` cannot omit a member:
   * adding one to the union makes this object literal a COMPILE error naming
   * the shape nobody has decided a half-height for. The values are the expected
   * answers for the default 1x1 / r=0.5 shape at scale 1, so this is also a
   * behavioural check rather than a smoke test.
   */
  it('covers every collider shape the store can hold, and answers for each', () => {
    const expected: Record<Collider2dShape['colliderShape'], number> = {
      box: 0.5,
      auto: 0.5,
      circle: 0.5,
      capsule: 0.5,
      // Three vertices are supplied by `shape()` below for this one.
      convex_polygon: 1,
      // A horizontal segment through the origin reaches nothing below it.
      edge: 0,
    };

    for (const [colliderShape, half] of Object.entries(expected)) {
      const input = shape({
        colliderShape: colliderShape as Collider2dShape['colliderShape'],
        vertices: [[-1, 1], [1, 1], [0, -1]],
      });
      expect(collider2dHalfHeight(input, 1), colliderShape).toBe(half);
    }
  });
});
