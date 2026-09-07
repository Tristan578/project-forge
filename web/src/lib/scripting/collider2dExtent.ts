/**
 * How far a 2D collider reaches BELOW its entity's transform origin.
 *
 * WHY THIS EXISTS. `forge.physics2d.isGrounded(id)` asks "is there a surface
 * within `distance` of my feet". The ray it casts started at the entity's
 * transform position, which is its CENTRE — Rapier's `Collider::cuboid` and
 * `Collider::ball` are both built around the origin (`make_collider_2d`,
 * `engine/src/core/physics_2d_sim.rs:58`). With the default collider size of
 * `[1, 1]` and the default `distance` of 0.1, that ray ends 0.4 units above the
 * entity's own lowest point and could never reach the floor it is standing on.
 *
 * That was invisible for as long as the caster itself was reported: the ray
 * started inside its own collider, `cast_ray(solid: true)` answered with it at
 * `toi = 0`, and the self-hit check turned that into `false`. Excluding the
 * caster removed the spurious hit and left the short ray hitting nothing — the
 * same permanent `false`, reached a different way. Both halves are needed: the
 * exclusion so the caster is not the answer, and this offset so the ray starts
 * where the caller thinks it does.
 *
 * WHY THE SHAPE MATH IS HERE AND NOT IN THE ENGINE. The ray itself stays a dumb
 * generic ray: `raycast2d` casts from the origin it is given, which is what
 * every other caller wants. "Where are my feet" is a question the script layer
 * asks, so the script layer answers it. The cost is that the cases below mirror
 * `make_collider_2d`, and `__tests__/collider2dExtent.test.ts` pins every arm of
 * that match so the two cannot drift apart silently.
 */

/** The 2D collider fields this needs, as the store holds them. */
export interface Collider2dShape {
  colliderShape: 'box' | 'circle' | 'capsule' | 'convex_polygon' | 'edge' | 'auto';
  size: [number, number];
  radius: number;
  vertices: [number, number][];
}

/**
 * Distance from the transform origin down to the collider's lowest point.
 *
 * Returns `0` for a shape with no vertical extent, and for anything whose
 * numbers are not finite — a `NaN` here would propagate into the ray origin and
 * make the engine's answer meaningless rather than merely wrong.
 */
export function collider2dHalfHeight(shape: Collider2dShape): number {
  const half = (n: number) => (Number.isFinite(n) ? Math.abs(n) * 0.5 : 0);

  switch (shape.colliderShape) {
    // `Collider::cuboid(size[0] * 0.5, size[1] * 0.5)`.
    case 'box':
    case 'auto':
      return half(shape.size?.[1]);

    // `Collider::ball(radius)` — the radius IS the half-height.
    case 'circle':
      return Number.isFinite(shape.radius) ? Math.abs(shape.radius) : 0;

    // `Collider::capsule_y(half_height, radius)` where
    // `half_height = (size[1] * 0.5 - radius).max(0.0)`. The capsule's total
    // reach is that half-height PLUS the end cap, so a capsule whose radius
    // exceeds `size[1] * 0.5` is a ball of that radius and reaches further than
    // `size[1] * 0.5` would suggest.
    case 'capsule': {
      const radius = Number.isFinite(shape.radius) ? Math.abs(shape.radius) : 0;
      return Math.max(half(shape.size?.[1]) - radius, 0) + radius;
    }

    // `Collider::convex_hull(vertices)`, falling back to the box when there are
    // fewer than three points. The hull's lowest point is the lowest vertex, so
    // this measures rather than assumes.
    case 'convex_polygon': {
      const ys = (shape.vertices ?? [])
        .map((v) => v?.[1])
        .filter((y): y is number => Number.isFinite(y));
      if (ys.length < 3) return half(shape.size?.[1]);
      return Math.max(0, -Math.min(...ys));
    }

    // `Collider::segment((-half_x, 0), (half_x, 0))` — a horizontal line
    // through the origin, so it reaches nothing below it.
    case 'edge':
      return 0;

    default:
      return 0;
  }
}
