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

/**
 * Do these points enclose no area?
 *
 * `Collider::convex_hull` answers `None` for input with no interior, and the
 * engine then falls back to the box — so this has to agree with it or the
 * browser and the engine disagree about where the collider is. Collinearity is
 * the reachable case: every cross product about the first point is zero.
 */
function isDegenerateHull(points: [number, number][]): boolean {
  const [ox, oy] = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const cross =
      (points[i][0] - ox) * (points[i + 1][1] - oy)
      - (points[i][1] - oy) * (points[i + 1][0] - ox);
    if (Math.abs(cross) > 1e-9) return false;
  }
  return true;
}

/** The 2D collider fields this needs, as the store holds them. */
export interface Collider2dShape {
  colliderShape: 'box' | 'circle' | 'capsule' | 'convex_polygon' | 'edge' | 'auto';
  size: [number, number];
  radius: number;
  vertices: [number, number][];
}

/**
 * Distance from the transform origin down to the collider's lowest point,
 * INCLUDING the entity's transform scale.
 *
 * THE SCALE IS NOT OPTIONAL AND NOT THE CALLER'S JOB. bevy_rapier's
 * `apply_scale` (`plugin/systems/collider.rs`) multiplies every collider by the
 * entity's `GlobalTransform` scale whenever no `ColliderScale` component is
 * present, and this repo inserts none — so the shape `make_collider_2d` builds
 * is never the shape that is simulated unless the scale happens to be 1.
 *
 * The first version of this function returned the unscaled half-height and left
 * the multiply to the one call site, which is a defect waiting for the second
 * call site. It also would have been wrong immediately: the shipped 2D
 * templates use `[2,1,1]`, `[3,0.5,1]`, `[0.6,0.6,1]` and `[1,2,1]`, so a
 * `scale.y` of 2 puts the feet 1.0 below the origin while 0.5 is subtracted —
 * the 0.1 ray then ends 0.4 short and `isGrounded` is permanently false, which
 * is the exact defect this file exists to fix. A `scale.y` below 1 is worse: the
 * origin lands BELOW the feet, inside the floor, and `cast_ray(solid: true)`
 * answers `toi = 0`, so an airborne entity reads as grounded.
 *
 * `scaleY` therefore has no default. Omitting it must be impossible, not quiet.
 *
 * Returns `0` for a shape with no vertical extent, and for anything whose
 * numbers are not finite — a `NaN` here would propagate into the ray origin and
 * make the engine's answer meaningless rather than merely wrong.
 */
export function collider2dHalfHeight(shape: Collider2dShape, scaleY: number): number {
  const scale = Number.isFinite(scaleY) ? Math.abs(scaleY) : 0;
  const half = (n: number) => (Number.isFinite(n) ? Math.abs(n) * 0.5 * scale : 0);

  switch (shape.colliderShape) {
    // `Collider::cuboid(size[0] * 0.5, size[1] * 0.5)`.
    case 'box':
    case 'auto':
      return half(shape.size?.[1]);

    // `Collider::ball(radius)` — the radius IS the half-height, and it is
    // scaled like everything else.
    case 'circle':
      return Number.isFinite(shape.radius) ? Math.abs(shape.radius) * scale : 0;

    // `Collider::capsule_y(half_height, radius)` where
    // `half_height = (size[1] * 0.5 - radius).max(0.0)`. The capsule's total
    // reach is that half-height PLUS the end cap, so a capsule whose radius
    // exceeds `size[1] * 0.5` is a ball of that radius and reaches further than
    // `size[1] * 0.5` would suggest.
    case 'capsule': {
      // Scaled, because `half()` above is: mixing a scaled half-height with an
      // unscaled radius would get the `.max(0.0)` clamp wrong in both directions.
      const radius = (Number.isFinite(shape.radius) ? Math.abs(shape.radius) : 0) * scale;
      return Math.max(half(shape.size?.[1]) - radius, 0) + radius;
    }

    // `Collider::convex_hull(vertices)`, falling back to
    // `Collider::cuboid(size * 0.5)` in TWO cases the engine treats alike: fewer
    // than three points, and a hull rapier refuses to build. The second is not
    // a count — `convex_hull` returns `None` for degenerate input, the clearest
    // case being three or more COLLINEAR points, which enclose no area. Missing
    // that arm would put the ray origin somewhere the collider does not reach.
    case 'convex_polygon': {
      const points = (shape.vertices ?? []).filter(
        (v): v is [number, number] =>
          Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]),
      );
      if (points.length < 3 || isDegenerateHull(points)) return half(shape.size?.[1]);
      const lowest = Math.min(...points.map((v) => v[1]));
      return Math.max(0, -lowest) * scale;
    }

    // `Collider::segment((-half_x, 0), (half_x, 0))` — a horizontal line
    // through the origin, so it reaches nothing below it.
    case 'edge':
      return 0;

    default:
      return 0;
  }
}
