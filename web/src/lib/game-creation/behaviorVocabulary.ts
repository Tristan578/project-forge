/**
 * The CLOSED set of per-entity behaviours the GDD generator may ask for.
 *
 * PF-1111 removed a free-text `behaviors` array because the model wrote prose
 * ("chase-player", "melee-attack") that no stage of the pipeline read. This is
 * the opposite shape and the reason the removal was safe: a fixed vocabulary,
 * enforced by `zBehavior` in the decomposition schema, where every entry maps
 * to something the engine already runs. Nothing here is free text and nothing
 * here is accepted without a plan.
 *
 * Three rules are load-bearing:
 *
 *  1. **The field is SINGULAR** (`behavior`, not `behaviors`). Not cosmetic:
 *     `decomposer.test.ts` asserts the decomposition prompt never contains the
 *     substring "behaviors", which is what stops the removed array coming back
 *     in through the prompt.
 *
 *  2. **A component beats a script.** Every entry whose motion an existing
 *     engine system already produces is planned as a `game_component`, not as
 *     generated source: `system_follower` and `system_moving_platform` run
 *     natively in Bevy, cost no tokens, need no LLM call and never touch the
 *     script sandbox. Scripts are the fallback for the entries the engine has
 *     no system for.
 *
 *  3. **`Record<Behavior, BehaviorPlan>` is the completeness proof.** Adding a
 *     verb to `BEHAVIOR_VOCAB` is a COMPILE ERROR until it is given a plan
 *     here — the same shape as `PHYSICS_ROLE_PROFILES` in `physicsRoles.ts`,
 *     and for the same reason: a vocabulary entry the planner silently ignores
 *     is an entity that stands still while the design says it hunts you.
 *
 * This module imports nothing from the project on purpose (only `zod`). It is
 * reached from an API route through `decomposer.ts` (see
 * `serverSafeImports.test.ts`) and it is imported by `types.ts`, so any project
 * import risks either the RSC boundary or a module cycle.
 */

import { z } from 'zod';

/**
 * Every behaviour the decomposition schema accepts. Anything else fails
 * validation and the decomposer retries, rather than being sanitized into a
 * value nothing consumes.
 */
export const BEHAVIOR_VOCAB = [
  'chase',
  'patrol',
  'flee',
  'idle',
  'projectile_fire',
] as const;

export type Behavior = (typeof BEHAVIOR_VOCAB)[number];

export const zBehavior = z.enum(BEHAVIOR_VOCAB);

/** Narrowing guard for values that arrive as plain strings (JSON fixtures). */
export function isBehavior(value: unknown): value is Behavior {
  if (typeof value !== 'string') return false;
  for (let i = 0; i < BEHAVIOR_VOCAB.length; i += 1) {
    if (BEHAVIOR_VOCAB[i] === value) return true;
  }
  return false;
}

/**
 * How a behaviour becomes something the engine actually runs.
 *
 * `summary` is not decoration: it is the sentence the decomposition prompt
 * shows the model for this verb, so the model is told what the word MEANS here
 * rather than being left to guess. `decomposer.test.ts` iterates
 * `BEHAVIOR_VOCAB` and fails when an entry is missing from the prompt, so a new
 * verb cannot ship undocumented to the model that has to emit it.
 */
export type BehaviorPlan =
  | {
      /** Nothing is planned. `idle` is a decision, not a gap. */
      substrate: 'none';
      needsTarget: false;
      summary: string;
    }
  | {
      /** An engine-native component. No tokens, no sandbox, no LLM call. */
      substrate: 'game_component';
      /** The `type` arm of `gameComponentExecutor`'s discriminated union. */
      component: 'follower' | 'movingPlatform';
      needsTarget: boolean;
      summary: string;
    }
  | {
      /** A hand-written, parameterized template — still no LLM call. */
      substrate: 'behavior_script';
      needsTarget: boolean;
      summary: string;
    };

/**
 * The one mapping table. A behaviour with no entry here does not compile.
 *
 * Why each substrate was chosen:
 *
 *  - `chase` -> `follower`. `system_follower` (engine/src/core/game_components.rs)
 *    already walks an entity toward a target every frame, and `challenge.ts`
 *    already plans it for enemies. Generating a script for this would be a
 *    second, slower, token-costing implementation of a system that ships.
 *  - `patrol` -> `movingPlatform`. `system_moving_platform` walks a waypoint
 *    route with a pause and a ping-pong loop, which is what a patrol IS. Its
 *    waypoints are OFFSETS from the spawn position, so the route travels from
 *    wherever the design placed the entity instead of teleporting it to the
 *    origin on the first frame.
 *  - `flee` -> script. No engine system inverts `follower`, and adding one is
 *    an engine change plus a WASM rebuild.
 *  - `projectile_fire` -> script. `system_spawner` produces entities on a timer
 *    but they do not travel, so a spawner is not a shooter. The template spawns
 *    AND moves the shot.
 *  - `idle` -> nothing. Planning an empty script for "stands still" would
 *    attach a compiled sandbox module that does nothing every frame.
 */
export const BEHAVIOR_PLANS: Readonly<Record<Behavior, BehaviorPlan>> = {
  chase: {
    substrate: 'game_component',
    component: 'follower',
    needsTarget: true,
    summary: 'moves toward the player continuously',
  },
  patrol: {
    substrate: 'game_component',
    component: 'movingPlatform',
    needsTarget: false,
    summary: 'travels back and forth along a fixed route near where it spawned',
  },
  flee: {
    substrate: 'behavior_script',
    needsTarget: true,
    summary: 'runs away from the player when the player gets close',
  },
  idle: {
    substrate: 'none',
    needsTarget: false,
    summary: 'stays where it was placed and does nothing',
  },
  projectile_fire: {
    substrate: 'behavior_script',
    needsTarget: true,
    summary: 'fires a projectile at the player on a fixed cadence',
  },
};

/**
 * True when a blueprint states a behaviour of its own.
 *
 * It lives in this import-free module, rather than next to the planner that
 * uses it, because `systems/challenge.ts` asks the SAME question to decide
 * whether to leave an entity alone (see the ownership note in
 * `behaviorSteps.ts`). One predicate means the two halves of that rule cannot
 * drift apart, and putting it here keeps `challenge.ts` out of a module cycle
 * with the planner.
 */
export function hasAuthoredBehavior(blueprint: { behavior?: Behavior }): boolean {
  return blueprint.behavior !== undefined;
}

/**
 * The vocabulary as the decomposition prompt states it, one line per verb.
 *
 * Derived from the table rather than restated, so a verb can never be listed to
 * the model with a meaning the planner does not implement.
 */
export function behaviorPromptLines(): string[] {
  const lines: string[] = [];
  for (let i = 0; i < BEHAVIOR_VOCAB.length; i += 1) {
    const behavior = BEHAVIOR_VOCAB[i];
    lines.push(`- "${behavior}": ${BEHAVIOR_PLANS[behavior].summary}`);
  }
  return lines;
}
