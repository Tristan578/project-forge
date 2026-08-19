/**
 * Challenge system definition — the GDD category that carries hazards and
 * obstacles.
 *
 * Before PF-1199 this category fell through to `custom_script_generate`, so the
 * spikes and the lava the design asked for were spawned as scenery: touching
 * one did nothing. Nothing in a generated game could hurt the player.
 *
 * Two rules are load-bearing:
 *
 *  1. A `damageZone` is bound to `entityId` — the engine UUID — never to the
 *     authored name. The engine matches on the `EntityId` component and emits
 *     nothing when nothing matches, and `dispatchCommand` returns void, so a
 *     step bound to a name fails in complete silence. A named hazard that
 *     resolves to no planned entity is therefore DROPPED with a warning rather
 *     than planned as a step certain to fail.
 *  2. The player's `health` is planned here ONLY when no health-shaped
 *     `feedback` system is going to plan it (see `feedbackPlansHealth`). A
 *     damage zone with nothing to damage is a hazard the player walks through,
 *     so the fallback exists — but two writers for one component is a race, not
 *     a design.
 */

import { registerSystem } from './registry';
import type { SystemStepInput, SystemStepContext, PlannedEntity } from './registry';
import type { GameSystem, OrchestratorGDD } from '../types';
// Reused rather than restated: a second copy of the health bag or of the
// health-shaped predicate is a copy that drifts, and the bag must stay COMPLETE
// (the engine merges a partial one onto `HealthData::default()` and reports
// nothing).
import { DEFAULT_MAX_HP, feedbackPlansHealth, healthStep, readMaxHp } from './feedback';

/** Matches `DamageZoneData::default()`, so an unstated rate is the engine's. */
const DEFAULT_DAMAGE_PER_SECOND = 25;
/** The engine clamps `damage_per_second` to this; a larger number is a typo. */
const MAX_DAMAGE_PER_SECOND = 10_000;

/** Config keys an LLM plausibly uses for "the things that hurt". */
const NAME_LIST_KEYS = ['hazards', 'obstacles', 'entities', 'traps', 'damageZones', 'dangers'];
/** Config keys an LLM plausibly uses for "how much it hurts". */
const DAMAGE_KEYS = ['damagePerSecond', 'damage', 'dps', 'damagePerHit', 'damageAmount'];
/** Config keys an LLM plausibly uses for "it kills outright". */
const ONE_SHOT_KEYS = ['oneShot', 'instantKill', 'lethal', 'instaKill'];

/**
 * Names that describe something that hurts on contact. Used only when the
 * design named no hazards explicitly — a role says what an object IS, and no
 * role means "hazard", so the name is the only signal left.
 */
const HAZARD_NAME_PATTERN =
  /spike|lava|acid|fire|flame|burn|trap|hazard|saw|blade|laser|pit|chasm|poison|toxic|thorn|electric|shock|bomb|mine|crush|danger|damage|obstacle/i;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Read a list of entity names out of an LLM-authored config bag. A single
 * comma-separated string is accepted alongside an array because the model
 * returns both spellings for the same field.
 *
 * `Object.hasOwn` rather than a bare index: `config['constructor']` resolves on
 * the prototype chain.
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
      // sparse list would report itself fully processed while losing an entry.
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

function readPositiveNumber(config: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (!Object.hasOwn(config, key)) continue;
    const value = config[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/** Only a real boolean. A truthy string is not a design decision. */
function readBoolean(config: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    if (!Object.hasOwn(config, key)) continue;
    const value = config[key];
    if (typeof value === 'boolean') return value;
  }
  return false;
}

function indexByName(entities: PlannedEntity[]): Map<string, PlannedEntity> {
  const index = new Map<string, PlannedEntity>();
  for (const entity of entities) {
    const key = normalize(entity.entity.name);
    if (key.length === 0 || index.has(key)) continue;
    index.set(key, entity);
  }
  return index;
}

function damageZoneStep(
  entity: PlannedEntity,
  damagePerSecond: number,
  oneShot: boolean,
): SystemStepInput {
  return {
    executor: 'game_component',
    input: {
      entityId: entity.entityId,
      type: 'damageZone',
      damagePerSecond,
      oneShot,
    },
  };
}

registerSystem({
  category: 'challenge',
  setupSteps(
    system: GameSystem,
    gdd: OrchestratorGDD,
    ctx: SystemStepContext,
  ): SystemStepInput[] {
    if (ctx.entities.length === 0) {
      ctx.warn(
        'The design asked for hazards but placed no objects in the world, so nothing was made dangerous.',
      );
      return [];
    }

    const names = readNameList(system.config);
    const hazards: PlannedEntity[] = [];
    const seen = new Set<string>();

    if (names.length > 0) {
      const index = indexByName(ctx.entities);

      for (const name of names) {
        const match = index.get(normalize(name));

        if (!match) {
          ctx.warn(
            `The design named "${name}" as a hazard, but no such object was placed in the world, so it was left out.`,
          );
          continue;
        }

        // A damage zone on the player damages the player continuously.
        if (match.entity.role === 'player') {
          ctx.warn(
            `The design named the player "${name}" as a hazard, which would hurt the player constantly, so it was left out.`,
          );
          continue;
        }

        if (seen.has(match.entityId)) continue;
        seen.add(match.entityId);
        hazards.push(match);
      }

      // Each dropped name already warned for itself.
      if (hazards.length === 0) return [];
    } else {
      // Nothing named: an enemy hurts on contact by convention, and for
      // everything else the name is the only signal there is.
      for (const entity of ctx.entities) {
        if (entity.entity.role === 'player') continue;
        const isHazard =
          entity.entity.role === 'enemy' || HAZARD_NAME_PATTERN.test(entity.entity.name);
        if (!isHazard) continue;
        if (seen.has(entity.entityId)) continue;
        seen.add(entity.entityId);
        hazards.push(entity);
      }

      if (hazards.length === 0) {
        ctx.warn(
          'The design asked for hazards but named none and placed no enemies, so nothing in the world can hurt the player.',
        );
        return [];
      }
    }

    const damagePerSecond = Math.min(
      readPositiveNumber(system.config, DAMAGE_KEYS) ?? DEFAULT_DAMAGE_PER_SECOND,
      MAX_DAMAGE_PER_SECOND,
    );
    const oneShot = readBoolean(system.config, ONE_SHOT_KEYS);

    const steps: SystemStepInput[] = [];

    // Health first, so the thing that has to survive the hazard is set up
    // before the hazard that damages it.
    const player = ctx.entities.find(e => e.entity.role === 'player');
    if (player && !feedbackPlansHealth(gdd)) {
      steps.push(healthStep(player, readMaxHp(system.config) ?? DEFAULT_MAX_HP, true));
    }

    for (const hazard of hazards) {
      steps.push(damageZoneStep(hazard, damagePerSecond, oneShot));
    }

    return steps;
  },
});
