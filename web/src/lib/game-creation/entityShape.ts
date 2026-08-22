/**
 * The one place a blueprint entity's VISUAL shape is decided.
 *
 * It used to live inside `entitySetupExecutor` alone, which was fine while the
 * spawn was the only thing that cared. It no longer is: the physics enablement
 * step has to pick a collider, and a collider that does not match the mesh is
 * the kind of defect nobody sees in review — the capsule player floats inside a
 * cuboid collider, the ball collectible is picked up a body-width early. Two
 * copies of this mapping would drift the first time an appearance string was
 * added to one of them.
 *
 * Server-safe: no `@/stores` or `@/hooks` VALUE import may ever appear here.
 * This module is reachable from `/api/game/decompose` through the executor
 * barrel, and one value edge into a client-only module fails `next build` with
 * an RSC boundary error that nothing in the local gate can see
 * (`.claude/rules/gotchas.md` -> Build & CI).
 */

import type { PhysicsData } from '@/stores/slices/types';

/**
 * The mesh primitives `spawn_entity` accepts. Its enum also carries the three
 * light types, deliberately excluded here: every later step in the plan
 * (physics enablement, physics profile, character rig, scripts) binds to the
 * entity as a body, so an appearance string must not be able to turn a gameplay
 * entity into a light.
 */
export const SPAWNABLE_SHAPES = [
  'cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus', 'capsule',
] as const;

export type SpawnShape = (typeof SPAWNABLE_SHAPES)[number];

const SPAWNABLE_SHAPE_SET: ReadonlySet<string> = new Set<string>(SPAWNABLE_SHAPES);

/** Map an entity role to the `spawn_entity` entityType it gets by default. */
export const ROLE_TO_ENTITY_TYPE: Readonly<Record<string, SpawnShape>> = {
  player: 'capsule',
  enemy: 'cube',
  npc: 'cube',
  decoration: 'cube',
  trigger: 'cube',
  interactable: 'cube',
  projectile: 'sphere',
};

const PRIMITIVE_APPEARANCE = /^\s*primitive:([a-z][a-z0-9_-]{0,63})\s*$/i;

/**
 * The GDD writes appearance as `primitive:<shape>` — the same convention the
 * asset manifest uses for fallbacks. When it names a shape the engine can spawn,
 * that is a deliberate design choice and outranks the role default. The field is
 * free text by contract, so anything else (prose, an unknown shape, a sprite
 * reference) yields undefined and the caller keeps the role default rather than
 * failing the step.
 */
export function shapeFromAppearance(appearance: string | undefined): SpawnShape | undefined {
  const match = appearance ? PRIMITIVE_APPEARANCE.exec(appearance) : null;
  if (!match) return undefined;
  const shape = match[1].toLowerCase();
  return SPAWNABLE_SHAPE_SET.has(shape) ? (shape as SpawnShape) : undefined;
}

/**
 * The entityType a blueprint entity is spawned as.
 *
 * 2D entities are textured planes — a capsule in a 2D scene is not a style
 * choice, it is a broken sprite — so the appearance override is 3D only.
 */
export function resolveEntityShape(
  role: string,
  appearance: string | undefined,
  projectType: '2d' | '3d',
): SpawnShape {
  if (projectType === '2d') return 'plane';
  return shapeFromAppearance(appearance) ?? ROLE_TO_ENTITY_TYPE[role] ?? 'cube';
}

/**
 * `ColliderShape` in engine/src/core/physics.rs is `snake_case`-serialized and
 * has exactly five variants: `cuboid`, `ball`, `cylinder`, `capsule`, `auto`.
 * `make_collider` builds `Auto` as a cuboid, so `auto` is never chosen here —
 * naming the shape explicitly is what makes a wrong pairing visible in a diff.
 *
 * DERIVED, not restated. `PhysicsData` is the TypeScript mirror of the Rust
 * enum, and a third hand-written copy of the variant list is a copy that goes
 * stale the first time the engine gains or renames one — the drift class this
 * repo has already paid for with `ENGINE_CAMERA_DEFAULTS`
 * (`.claude/rules/gotchas.md` -> Engine & Game Loop). Deriving makes a rename
 * upstream a compile error in `COLLIDER_FOR_SHAPE` below instead of a payload
 * `serde` drops in silence.
 */
export type ColliderShapeName = PhysicsData['colliderShape'];

/**
 * The collider that fits each spawnable mesh.
 *
 * `plane`, `cone` and `torus` have no matching Rapier primitive in
 * `make_collider`, so they take the cuboid its `Auto` arm would have produced —
 * an approximation, but a solid one, and the alternative (no collider) is the
 * bug this whole ticket is about.
 */
export const COLLIDER_FOR_SHAPE: Readonly<Record<SpawnShape, ColliderShapeName>> = {
  cube: 'cuboid',
  sphere: 'ball',
  plane: 'cuboid',
  cylinder: 'cylinder',
  cone: 'cuboid',
  torus: 'cuboid',
  capsule: 'capsule',
};
