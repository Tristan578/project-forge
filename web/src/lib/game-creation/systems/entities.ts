/**
 * Entities system definition — the GDD category that names the things in the
 * world worth touching.
 *
 * Before PF-1199 this category fell through to `custom_script_generate`, so a
 * generated game got a script and no components: the coins spawned, nothing
 * happened when the player ran through them, no score accumulated, and the
 * score win condition the progression system plans could never be met. A room
 * with a player in it.
 *
 * This definition does NOT spawn anything. planBuilder Phase 2 has already
 * walked `gdd.scenes[].entities` and minted an engine UUID per entity; this
 * runs in Phase 3 and only attaches `collectible` components to entities that
 * already exist. Registering the category is therefore safe — the duplicate
 * `spawn_entity` hazard that kept it unregistered does not apply to a
 * component-only definition.
 *
 * Two rules are load-bearing:
 *
 *  1. A component is bound to `entityId` — the engine UUID — and never to the
 *     authored name. The engine matches on the `EntityId` component and its
 *     match loops emit nothing when nothing matches, so a step bound to a name
 *     is a silent no-op that `dispatchCommand` (which returns void) cannot
 *     report.
 *  2. A name the GDD invented that resolves to no planned entity is DROPPED
 *     with a warning. Planning it anyway would be planning a step certain to
 *     fail, and one failed step marks the whole plan failed.
 */

import { registerSystem } from './registry';
import type { SystemStepInput, SystemStepContext, PlannedEntity } from './registry';
import type { GameSystem, OrchestratorGDD } from '../types';

/** Points awarded per pickup when the design named no number. */
const DEFAULT_COLLECTIBLE_VALUE = 10;
/** Degrees per second. Matches the spin the progression system gives pickups. */
const DEFAULT_ROTATE_SPEED = 90;

/** Config keys an LLM plausibly uses for "the things to pick up". */
const NAME_LIST_KEYS = ['collectibles', 'pickups', 'entities', 'items', 'objects'];
/** Config keys an LLM plausibly uses for "points per pickup". */
const VALUE_KEYS = ['value', 'collectibleValue', 'pointsPerPickup', 'pointValue', 'points'];

/** LLM-authored names arrive in every casing and punctuation. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Read a list of entity names out of an LLM-authored config bag.
 *
 * A single comma-separated string is accepted alongside an array because both
 * spellings come back from the model for the same field. Non-string members are
 * ignored rather than coerced: `String({})` is `"[object Object]"`, which would
 * resolve to nothing and produce a warning about a name nobody wrote.
 *
 * `Object.hasOwn` rather than a bare index: `config['constructor']` resolves on
 * the prototype chain and would hand back a function.
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

/** A positive finite number from an LLM-authored config bag, or null. */
function readPositiveNumber(config: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (!Object.hasOwn(config, key)) continue;
    const value = config[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return null;
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

function collectibleStep(entity: PlannedEntity, value: number): SystemStepInput {
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

registerSystem({
  category: 'entities',
  setupSteps(
    system: GameSystem,
    _gdd: OrchestratorGDD,
    ctx: SystemStepContext,
  ): SystemStepInput[] {
    if (ctx.entities.length === 0) {
      ctx.warn(
        'The design asked for pickups but placed no objects in the world, so there was nothing to make collectible.',
      );
      return [];
    }

    const value = readPositiveNumber(system.config, VALUE_KEYS) ?? DEFAULT_COLLECTIBLE_VALUE;
    const names = readNameList(system.config);
    const targets: PlannedEntity[] = [];
    const seen = new Set<string>();

    if (names.length > 0) {
      const index = indexByName(ctx.entities);

      for (const name of names) {
        const match = index.get(normalize(name));

        if (!match) {
          ctx.warn(
            `The design named "${name}" as something to pick up, but no such object was placed in the world, so it was left out.`,
          );
          continue;
        }

        // A collectible is destroyed on contact with the player. Making the
        // player one would delete the player the instant the game started.
        if (match.entity.role === 'player') {
          ctx.warn(
            `The design named the player "${name}" as something to pick up, which would remove the player on the first frame, so it was left out.`,
          );
          continue;
        }

        if (seen.has(match.entityId)) continue;
        seen.add(match.entityId);
        targets.push(match);
      }

      // Every warning has already named its own entity; a summary here would
      // repeat what the user was just told.
      return targets.map(target => collectibleStep(target, value));
    }

    // Nothing named: the GDD marks pickups by role.
    for (const entity of ctx.entities) {
      if (entity.entity.role !== 'interactable') continue;
      if (seen.has(entity.entityId)) continue;
      seen.add(entity.entityId);
      targets.push(entity);
    }

    if (targets.length === 0) {
      ctx.warn(
        'The design asked for pickups but named nothing to pick up and marked no object as interactable, so nothing was made collectible.',
      );
      return [];
    }

    return targets.map(target => collectibleStep(target, value));
  },
});
