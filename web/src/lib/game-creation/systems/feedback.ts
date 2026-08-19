/**
 * Feedback system definition — the GDD category that carries health and damage.
 *
 * Registering a category REMOVES planBuilder's `custom_script_generate`
 * fall-through for it, so a feedback system this file cannot translate must say
 * so rather than silently produce nothing: before PF-1199 those systems at
 * least got a generated script.
 *
 * Health property bags are emitted COMPLETE. `build_game_component` starts from
 * `HealthData::default()` and merges the keys it recognises, so an omitted
 * field is not rejected — it silently keeps the ENGINE default, and
 * `dispatchCommand` returns void so nothing reports the divergence.
 */

import { registerSystem } from './registry';
import type { SystemStepInput, SystemStepContext, PlannedEntity } from './registry';
import type { GameSystem, OrchestratorGDD } from '../types';

export const DEFAULT_MAX_HP = 100;
/** Matches `HealthData`'s own default respawn height. */
const DEFAULT_RESPAWN_POINT: [number, number, number] = [0, 1, 0];
/** A brief mercy window after a hit, so a single contact is not instant death. */
const PLAYER_INVINCIBILITY_SECS = 0.5;

export const HP_CONFIG_KEYS = ['maxHealth', 'maxHp', 'max_hp', 'health', 'hp', 'hitPoints'];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * `Object.hasOwn` rather than a bare index: the config is LLM-authored, and
 * `config['constructor']` resolves on the prototype chain.
 */
export function readMaxHp(config: Record<string, unknown>): number | null {
  for (const key of HP_CONFIG_KEYS) {
    if (!Object.hasOwn(config, key)) continue;
    const value = config[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/**
 * A feedback system is about health when it says so, or when its config carries
 * a hit-point number whatever the system is called — `feedback | hud` with a
 * `maxHealth` is a health system that was named after its UI.
 */
export function isHealthShaped(system: GameSystem): boolean {
  const type = normalize(system.type);
  if (/health|damage|hp|hitpoint|hurt|combat|lives/.test(type)) return true;
  return HP_CONFIG_KEYS.some(key => Object.hasOwn(system.config, key));
}

export function healthStep(entity: PlannedEntity, maxHp: number, isPlayer: boolean): SystemStepInput {
  return {
    executor: 'game_component',
    input: {
      entityId: entity.entityId,
      type: 'health',
      maxHp,
      currentHp: maxHp,
      // The player gets a mercy window and a respawn; an enemy that respawned
      // on death could never be cleared, and one that lingered as a corpse
      // would keep colliding.
      invincibilitySecs: isPlayer ? PLAYER_INVINCIBILITY_SECS : 0,
      respawnOnDeath: isPlayer,
      respawnPoint: [...DEFAULT_RESPAWN_POINT] as [number, number, number],
      despawnOnDeath: !isPlayer,
    },
  };
}

/**
 * Whether the `feedback` category is going to plan a health component.
 *
 * `challenge` asks this before planning a fallback health of its own. The two
 * would not collide destructively — the store's `addGameComponent` replaces a
 * component of the same type on that entity — but "harmless because the last
 * writer wins" is a race, not a design: whichever step ran second would decide
 * the player's hit points, and feedback's number comes from the GDD while
 * challenge's is a fallback.
 *
 * The question is answered from `gdd.systems` rather than from the steps
 * already planned, because a plan is built system by system and challenge can
 * be reached before feedback. It is an approximation in one direction only:
 * feedback also declines to plan health when the world holds no player or
 * enemy, in which case challenge stands down too — but challenge only reaches
 * this question when it HAS found a player, so that case cannot arise.
 */
export function feedbackPlansHealth(gdd: OrchestratorGDD): boolean {
  return gdd.systems.some(s => s.category === 'feedback' && isHealthShaped(s));
}

registerSystem({
  category: 'feedback',
  setupSteps(
    system: GameSystem,
    _gdd: OrchestratorGDD,
    ctx: SystemStepContext,
  ): SystemStepInput[] {
    if (!isHealthShaped(system)) {
      ctx.warn(
        `The design asked for a "${system.type}" feedback system, which has no direct equivalent yet, so it was left out.`,
      );
      return [];
    }

    if (ctx.entities.length === 0) {
      ctx.warn(
        'The design asked for health and damage but placed no objects in the world, so nothing was given hit points.',
      );
      return [];
    }

    // Only things that fight. Scenery with hit points would be destructible by
    // accident, and a collectible with health can be killed instead of picked
    // up.
    const damageable = ctx.entities.filter(
      e => e.entity.role === 'player' || e.entity.role === 'enemy',
    );

    if (damageable.length === 0) {
      ctx.warn(
        'The design asked for health and damage but named no player or enemies, so nothing was given hit points.',
      );
      return [];
    }

    const maxHp = readMaxHp(system.config) ?? DEFAULT_MAX_HP;

    return damageable.map(entity =>
      healthStep(entity, maxHp, entity.entity.role === 'player'),
    );
  },
});
