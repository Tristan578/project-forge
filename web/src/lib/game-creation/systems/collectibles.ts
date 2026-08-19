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

/** LLM-authored names arrive in every casing and punctuation. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * A positive finite number from an LLM-authored config bag, or null.
 *
 * `Object.hasOwn` rather than a bare index: `config['constructor']` resolves on
 * the prototype chain and would hand back a function.
 */
export function readPositiveNumber(
  config: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    if (!Object.hasOwn(config, key)) continue;
    const value = config[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/**
 * Read a list of entity names out of an LLM-authored config bag.
 *
 * A single comma-separated string is accepted alongside an array because both
 * spellings come back from the model for the same field. Non-string members are
 * ignored rather than coerced: `String({})` is `"[object Object]"`, which would
 * resolve to nothing and produce a warning about a name nobody wrote.
 */
function readNameList(config: Record<string, unknown>): string[] {
  for (const key of NAME_LIST_KEYS) {
    if (!Object.hasOwn(config, key)) continue;
    const value = config[key];

    if (typeof value === 'string') {
      const names = value.split(',').map(part => part.trim()).filter(part => part.length > 0);
      if (names.length > 0) return names;
      continue;
    }

    if (Array.isArray(value)) {
      const names: string[] = [];
      // Indexed read, not `.filter`: a callback form skips array holes, so a
      // sparse list would report itself fully processed while silently losing
      // an entry.
      for (let i = 0; i < value.length; i += 1) {
        const member = value[i];
        if (typeof member !== 'string') continue;
        const trimmed = member.trim();
        if (trimmed.length > 0) names.push(trimmed);
      }
      if (names.length > 0) return names;
    }
  }
  return [];
}

/** First entity wins a duplicated name — a later duplicate is a design error. */
function indexByName(entities: PlannedEntity[]): Map<string, PlannedEntity> {
  const index = new Map<string, PlannedEntity>();
  for (const entity of entities) {
    const key = normalize(entity.entity.name);
    if (key.length === 0 || index.has(key)) continue;
    index.set(key, entity);
  }
  return index;
}

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

  const names = ownerSystem ? readNameList(ownerSystem.config) : [];
  const targets: PlannedEntity[] = [];
  const seen = new Set<string>();

  if (names.length > 0) {
    const index = indexByName(ctx.entities);

    for (const name of names) {
      const match = index.get(normalize(name));

      if (!match) {
        warn(
          `The design named "${name}" as something to pick up, but no such object was placed in the world, so it was left out.`,
        );
        continue;
      }

      // A collectible is destroyed on contact with the player. Making the
      // player one would delete the player the instant the game started.
      if (match.entity.role === 'player') {
        warn(
          `The design named the player "${name}" as something to pick up, which would remove the player on the first frame, so it was left out.`,
        );
        continue;
      }

      if (seen.has(match.entityId)) continue;
      seen.add(match.entityId);
      targets.push(match);
    }

    return { targets, value, named: true };
  }

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
