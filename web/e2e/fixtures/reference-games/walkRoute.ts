/**
 * Can the CURRENT 2D character controller walk a 2D reference game from its
 * spawn to its goal? (#10159, engine limitation tracked at #10378)
 *
 * In a 2D project the engine takes the legacy direct-translation branch of
 * `system_character_controller` (`engine/src/core/game_components.rs`): input
 * writes the transform at `speed` units a second, a jump press is a one-frame
 * nudge, and the only gravity is the 2D simulation's on the dynamic body. The
 * consequences this module encodes:
 *
 * - the player can walk right and left, and fall; it cannot climb. A floor
 *   that rises, even by a hundredth of a unit, is a wall;
 * - a jump does not carry the body anywhere, so a route that needs one (a
 *   floating platform, a gap) cannot be completed;
 * - how far the body drifts sideways while it falls depends on the frame rate
 *   (the controller moves by the frame's `dt`, the simulation's step is capped),
 *   so a route that needs a particular landing spot is not reproducible. The
 *   check below therefore accepts no gap at all that the box cannot straddle.
 *
 * The model is deliberately small. The player's box sweeps sideways from its
 * spawn in fixed steps. At every step it needs a solid under it, and nothing
 * solid may stand in the band it occupies above the floor it is on. The sweep
 * stops when the box first touches its target: the goal for the winning walk
 * (right), a damage zone for the losing one (left). Everything read here is
 * fixture data (a 2D collider's centre is the entity's position, its size the
 * collider's size), so the check fails the moment a fixture edit re-adds a climb
 * or a gap, long before a slow engine journey would.
 *
 * Plain data and pure helpers only, like `referenceGame.ts`.
 */
import type { ReferenceEntity, ReferenceGame } from './referenceGame';

/** Float noise, not geometry: tops closer than this are the same height. */
export const LEVEL_TOLERANCE = 1e-6;

/** Horizontal distance between two samples of the sweep, in world units. */
export const SWEEP_STEP = 0.01;

/** An axis-aligned box in world units (the XY plane of a 2D project). */
export interface WorldBox {
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Which way the player holds. Only horizontal input is modelled: a jump carries nothing. */
export type WalkDirection = 'right' | 'left';

/** What a walk found. `problems` is empty exactly when the route is completable. */
export interface WalkRouteReport {
  /** Ids of the solids the player stood on, in the order it reached them. */
  surfaces: string[];
  /** Ids of the collectibles the box touched before it touched its target. */
  collected: string[];
  /**
   * Every way the walk failed, each line starting with the field at fault
   * (`spawn:`, `gap:`, `climb:`, `hazard:`, `target:`, `collectible:`), so a test
   * can pin the REASON a route was refused and not merely that it was.
   */
  problems: string[];
}

/** The collider of a 2D entity as a world box. Throws for an entity with no 2D collider. */
export function boxOf(entity: ReferenceEntity): WorldBox {
  if (entity.physics?.dimension !== '2d') {
    throw new Error(`entity "${entity.id}" has no 2D collider`);
  }
  const [width, height] = entity.physics.data.size;
  const [x, y] = entity.position;
  return { id: entity.id, minX: x - width / 2, maxX: x + width / 2, minY: y - height / 2, maxY: y + height / 2 };
}

/** A static, non-sensor 2D body: what the player stands on and bumps into. */
function isSolid(entity: ReferenceEntity): boolean {
  return entity.physics?.dimension === '2d' && entity.physics.data.bodyType === 'static' && !entity.physics.data.isSensor;
}

function hasComponent(entity: ReferenceEntity, type: ReferenceEntity['gameComponents'][number]['type']): boolean {
  return entity.gameComponents.some((c) => c.type === type);
}

function round(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * Sweep the player's box sideways from its spawn until it first touches the
 * entity `targetId`, and report whether that walk is possible for the legacy 2D
 * controller. Damage zones other than the target count against the walk.
 */
export function walkRoute(game: ReferenceGame, direction: WalkDirection, targetId: string): WalkRouteReport {
  const surfaces: string[] = [];
  const collected: string[] = [];
  const problems: string[] = [];

  const players = game.entities.filter((e) => hasComponent(e, 'characterController'));
  const targetEntity = game.entities.find((e) => e.id === targetId);
  if (players.length !== 1 || targetEntity === undefined) {
    problems.push(
      `spawn: expected one character controller and the entity "${targetId}", found ${players.length} and ${targetEntity ? 1 : 0}`,
    );
    return { surfaces, collected, problems };
  }

  const sign = direction === 'right' ? 1 : -1;
  const player = boxOf(players[0]);
  const target = boxOf(targetEntity);
  const halfWidth = (player.maxX - player.minX) / 2;
  const height = player.maxY - player.minY;
  const spawnX = (player.minX + player.maxX) / 2;

  const solids = game.entities.filter(isSolid).map(boxOf);
  const hazards = game.entities
    .filter((e) => e.id !== targetId && hasComponent(e, 'damageZone'))
    .map(boxOf);
  const collectibles = game.entities.filter((e) => e.id !== targetId && hasComponent(e, 'collectible')).map(boxOf);

  // The box overlaps `other` when the interiors intersect; touching edges do not count.
  const overlapsX = (other: WorldBox, centre: number) =>
    other.minX < centre + halfWidth - LEVEL_TOLERANCE && other.maxX > centre - halfWidth + LEVEL_TOLERANCE;
  const overlapsBand = (other: WorldBox, centre: number, floor: number) =>
    overlapsX(other, centre) && other.minY < floor + height - LEVEL_TOLERANCE && other.maxY > floor + LEVEL_TOLERANCE;

  const embedded = solids.filter((s) => overlapsBand(s, spawnX, player.minY));
  if (embedded.length > 0) {
    problems.push(`spawn: the player starts inside ${embedded.map((s) => s.id).join(', ')}`);
    return { surfaces, collected, problems };
  }

  // The floor the player starts on is the highest solid at or below its feet.
  let floor = Number.NEGATIVE_INFINITY;
  for (const solid of solids) {
    if (overlapsX(solid, spawnX) && solid.maxY <= player.minY + LEVEL_TOLERANCE) floor = Math.max(floor, solid.maxY);
  }
  if (floor === Number.NEGATIVE_INFINITY) {
    problems.push(`spawn: nothing solid is under the player at x=${round(spawnX)}`);
    return { surfaces, collected, problems };
  }

  // The walk ends once the box has passed the target's far edge without touching it.
  const lastX = direction === 'right' ? target.maxX + halfWidth : target.minX - halfWidth;
  const hazardsHit = new Set<string>();
  let touchedTarget = false;

  for (let i = 0; sign * (spawnX + sign * i * SWEEP_STEP - lastX) <= 0; i += 1) {
    const x = spawnX + sign * i * SWEEP_STEP;
    const under = solids.filter((s) => overlapsX(s, x));

    // Supported while any part of the box is over a solid no higher than the
    // floor it is on: the player falls to a lower floor only once it has
    // cleared the higher one, and never rises to a higher one.
    const supports = under.filter((s) => s.maxY <= floor + LEVEL_TOLERANCE);
    if (supports.length === 0) {
      problems.push(
        `gap: from x=${round(x - halfWidth)} to x=${round(x + halfWidth)} nothing is under the box at floor y=${round(floor)}` +
          ' (the legacy 2D controller cannot jump or steer a fall)',
      );
      break;
    }
    floor = Math.max(...supports.map((s) => s.maxY));
    for (const s of supports) {
      if (Math.abs(s.maxY - floor) <= LEVEL_TOLERANCE && !surfaces.includes(s.id)) surfaces.push(s.id);
    }

    const blockers = under.filter((s) => s.maxY > floor + LEVEL_TOLERANCE && s.minY < floor + height - LEVEL_TOLERANCE);
    if (blockers.length > 0) {
      const wall = blockers[0];
      problems.push(
        `climb: at x=${round(x)} ${wall.id} rises to y=${round(wall.maxY)} across a floor at y=${round(floor)}` +
          ' (the legacy 2D controller cannot climb or fit under it)',
      );
      break;
    }

    for (const hazard of hazards) {
      if (overlapsBand(hazard, x, floor)) hazardsHit.add(hazard.id);
    }
    for (const coin of collectibles) {
      if (overlapsBand(coin, x, floor) && !collected.includes(coin.id)) collected.push(coin.id);
    }
    if (overlapsBand(target, x, floor)) {
      touchedTarget = true;
      break;
    }
  }

  if (problems.length > 0) return { surfaces, collected, problems };

  if (!touchedTarget) {
    problems.push(
      `target: walking ${direction} the box passes ${target.id} (x ${round(target.minX)}..${round(target.maxX)}) without touching it`,
    );
  }
  for (const id of hazardsHit) {
    problems.push(`hazard: walking ${direction} to ${target.id} touches the damage zone ${id}`);
  }
  return { surfaces, collected, problems };
}

/**
 * The winning route: hold right from the spawn to the win-condition entity. On
 * top of `walkRoute`'s checks, every collectible must be touched on the way, so
 * the game's "something to collect" is something the winning walk really
 * collects.
 */
export function walkRightRoute(game: ReferenceGame): WalkRouteReport {
  const report = walkRoute(game, 'right', game.winConditionEntityId);
  // Without a completed walk the collectibles it did not reach are a symptom, not a finding.
  if (report.problems.length > 0) return report;
  const missed = game.entities
    .filter((e) => e.id !== game.winConditionEntityId && hasComponent(e, 'collectible'))
    .filter((e) => !report.collected.includes(e.id));
  return {
    ...report,
    problems: missed.map((e) => `collectible: ${e.id} is not touched on the walk to the goal`),
  };
}
