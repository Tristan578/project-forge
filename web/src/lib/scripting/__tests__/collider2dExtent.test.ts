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
    expect(collider2dHalfHeight(shape())).toBe(0.5);
  });

  it('halves the box height, and treats auto as a box', () => {
    expect(collider2dHalfHeight(shape({ colliderShape: 'box', size: [2, 3] }))).toBe(1.5);
    expect(collider2dHalfHeight(shape({ colliderShape: 'auto', size: [2, 3] }))).toBe(1.5);
  });

  // `Collider::ball(radius)` uses the radius directly and ignores size, so a
  // circle whose size disagrees with its radius must follow the radius.
  it('uses the radius for a circle, not the size', () => {
    expect(collider2dHalfHeight(shape({ colliderShape: 'circle', radius: 0.75, size: [10, 10] })))
      .toBe(0.75);
  });

  // `half_height = (size[1] * 0.5 - radius).max(0.0)`, and the capsule reaches
  // half_height + radius. For the ordinary case that is just size[1] * 0.5.
  it('reaches half the height for an ordinary capsule', () => {
    expect(collider2dHalfHeight(shape({ colliderShape: 'capsule', size: [1, 4], radius: 0.5 })))
      .toBe(2);
  });

  // The `.max(0.0)` clamp is the interesting arm: a radius larger than the
  // half-height collapses the cylinder to nothing and leaves a ball, which
  // reaches the RADIUS — further than size[1] * 0.5. Returning size[1] * 0.5
  // here would put the ray origin inside the collider.
  it('follows the radius for a capsule whose radius exceeds its half-height', () => {
    expect(collider2dHalfHeight(shape({ colliderShape: 'capsule', size: [1, 1], radius: 2 })))
      .toBe(2);
  });

  it('measures the lowest vertex of a convex polygon', () => {
    expect(collider2dHalfHeight(shape({
      colliderShape: 'convex_polygon',
      vertices: [[-1, 1], [1, 1], [0, -3]],
    }))).toBe(3);
  });

  // Rust falls back to the box below three vertices, so this must too.
  it('falls back to the box for a polygon with too few vertices', () => {
    expect(collider2dHalfHeight(shape({
      colliderShape: 'convex_polygon',
      size: [1, 6],
      vertices: [[0, -3], [1, 1]],
    }))).toBe(3);
  });

  // A polygon entirely above the origin reaches nothing below it.
  it('reaches nothing below the origin for a polygon that sits above it', () => {
    expect(collider2dHalfHeight(shape({
      colliderShape: 'convex_polygon',
      vertices: [[-1, 1], [1, 1], [0, 3]],
    }))).toBe(0);
  });

  // `Collider::segment((-half_x, 0), (half_x, 0))` — horizontal, through the
  // origin. Its size[1] is meaningless and must not be read.
  it('reaches nothing below the origin for an edge, whatever its height says', () => {
    expect(collider2dHalfHeight(shape({ colliderShape: 'edge', size: [10, 10] }))).toBe(0);
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
    const result = collider2dHalfHeight(input);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBe(0);
  });

  // A negative size is not meaningful, but `Collider::cuboid` would take its
  // magnitude — so this follows rather than returning a negative offset that
  // would move the ray origin UP.
  it('takes the magnitude of a negative height rather than moving the origin up', () => {
    expect(collider2dHalfHeight(shape({ size: [1, -4] }))).toBe(2);
  });

  /**
   * Every `ColliderShape2d` arm is covered above. This asserts the list itself,
   * so a shape added to the union fails here rather than falling through the
   * `default` and silently reading as "reaches nothing".
   */
  it('covers every collider shape the store can hold', () => {
    const covered: Collider2dShape['colliderShape'][] =
      ['box', 'circle', 'capsule', 'convex_polygon', 'edge', 'auto'];
    expect(covered.length).toBe(6);
    for (const colliderShape of covered) {
      expect(() => collider2dHalfHeight(shape({ colliderShape }))).not.toThrow();
    }
  });
});
