/**
 * The one resolution of "what can the player pick up, and what is each worth".
 *
 * Two system definitions attach `collectible` components: `entities`, which is
 * the category that names the things in the world worth touching, and
 * `progression`, which needs a per-pickup value to derive a score target from.
 * Both used to work this out independently — different config keys, separate
 * defaults, separate target selection — and both emitted a component for the
 * same entity. `add_game_component` replaces, so one silently overwrote the
 * other, while the score target stayed derived from the value that lost.
 *
 * A design declaring both systems could therefore be handed a target no amount
 * of collecting could reach: a game that starts, looks correct, and cannot be
 * finished. Nothing reports it — the winnability gate checks that a condition
 * EXISTS, not that its arithmetic closes.
 *
 * So the resolution lives here once, and exactly one definition emits it. The
 * owner is `entities` wherever the design declares one, because it is the only
 * one that can target pickups by name; `progression` otherwise.
 */

import type { SystemStepInput, SystemStepContext, PlannedEntity } from './registry';
import type { GameSystem, OrchestratorGDD } from '../types';
import { readNameList, readPositiveNumber, resolveNames } from './configRead';

/** Points awarded per pickup when the design named no number. */
export const DEFAULT_COLLECTIBLE_VALUE = 10;
/** Degrees per second. */
const DEFAULT_ROTATE_SPEED = 90;

/** Config keys an LLM plausibly uses for "the things to pick up". */
const NAME_LIST_KEYS = ['collectibles', 'pickups', 'entities', 'items', 'objects'];
/**
 * Config keys an LLM plausibly uses for "points per pickup".
 *
 * One list, read against whichever system carries the number. Two lists is how
 * the same design ended up with two different values in the first place.
 */
const VALUE_KEYS = ['value', 'collectibleValue', 'pointsPerPickup', 'pointValue', 'points'];

/** The step that makes one entity a pickup. */
export function collectibleStep(entity: PlannedEntity, value: number): SystemStepInput {
  return {
    executor: 'game_component',
    input: {
      entityId: entity.entityId,
      type: 'collectible',
      value,
      destroyOnCollect: true,
      pickupSoundAsset: null,
      rotateSpeed: DEFAULT_ROTATE_SPEED,
    },
  };
}

/** The system category that emits the `collectible` components for a design. */
export type CollectibleOwner = 'entities' | 'progression';

/**
 * Which definition owns the components — `entities` where the design declares
 * one, since it is the only one that can target pickups by name.
 *
 * `system` is the one currently being planned, and it wins over the GDD's own
 * list: `planBuilder` hands `setupSteps` the resolved system, which is the
 * authority on its own config, and a GDD whose `systems` array has been
 * narrowed since must not make the definition that is running invisible to
 * itself.
 */
export function collectibleOwner(
  system: GameSystem,
  gdd: OrchestratorGDD,
): CollectibleOwner {
  if (system.category === 'entities') return 'entities';
  return gdd.systems.some(s => s.category === 'entities') ? 'entities' : 'progression';
}

export interface ResolvedCollectibles {
  /** The entities that become pickups, in plan order. */
  targets: PlannedEntity[];
  /** Points each one is worth. */
  value: number;
  /**
   * Whether the design named its pickups explicitly.
   *
   * A named list that resolves to nothing has already warned once per name, so
   * the caller must not add a summary on top; the role path can come back empty
   * having said nothing at all, and there a summary is the only explanation.
   */
  named: boolean;
}

/** The system carrying a category's config — the one being planned wins. */
function systemOfCategory(
  system: GameSystem,
  gdd: OrchestratorGDD,
  category: string,
): GameSystem | undefined {
  if (system.category === category) return system;
  return gdd.systems.find(s => s.category === category);
}

/**
 * Resolve the pickups a design describes.
 *
 * `warn` is passed in rather than taken from `ctx` so the definition that does
 * NOT emit can resolve silently: the user should be told once that a named
 * pickup does not exist, not once per system that happened to look.
 */
export function resolveCollectibles(
  system: GameSystem,
  gdd: OrchestratorGDD,
  ctx: SystemStepContext,
  warn: (message: string) => void,
): ResolvedCollectibles {
  const owner = collectibleOwner(system, gdd);
  const ownerSystem = systemOfCategory(system, gdd, owner);
  const otherSystem = systemOfCategory(
    system,
    gdd,
    owner === 'entities' ? 'progression' : 'entities',
  );

  // Owner first, then the other system: a design that put the number on the
  // progression system and the name list on the entities system meant both, and
  // ignoring one of them silently would be inventing a value it never wrote.
  const value =
    (ownerSystem ? readPositiveNumber(ownerSystem.config, VALUE_KEYS) : null)
    ?? (otherSystem ? readPositiveNumber(otherSystem.config, VALUE_KEYS) : null)
    ?? DEFAULT_COLLECTIBLE_VALUE;

  const names = ownerSystem ? readNameList(ownerSystem.config, NAME_LIST_KEYS) : [];

  if (names.length > 0) {
    const targets = resolveNames(
      names,
      ctx.entities,
      warn,
      name =>
        `The design named "${name}" as something to pick up, but no such object was placed in the world, so it was left out.`,
      // A collectible is destroyed on contact with the player. Making the
      // player one would delete the player the instant the game started.
      (entity, name) =>
        entity.entity.role === 'player'
          ? `The design named the player "${name}" as something to pick up, which would remove the player on the first frame, so it was left out.`
          : null,
    );
    return { targets, value, named: true };
  }

  const targets: PlannedEntity[] = [];
  const seen = new Set<string>();

  // Nothing named: the GDD marks pickups by role.
  for (const entity of ctx.entities) {
    if (entity.entity.role !== 'interactable') continue;
    if (seen.has(entity.entityId)) continue;
    seen.add(entity.entityId);
    targets.push(entity);
  }

  return { targets, value, named: false };
}

/** A `warn` that discards, for the definition that is only reading. */
export const IGNORE_WARNINGS: (message: string) => void = () => {};
