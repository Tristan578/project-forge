/**
 * Progression system definition — the only thing in the pipeline that plans a
 * win condition.
 *
 * Without a `winCondition` component `validateWinnability` answers
 * NO_WIN_CONDITION and `gameSlice.play()` returns before it ever dispatches, so
 * a generated game cannot be played at all (PF-1199).
 *
 * The rule this file follows: never plan a condition the winnability gate would
 * refuse. A `collectAll` with nothing to collect and a `reachGoal` with no goal
 * are both unsatisfiable, so they are DROPPED with a warning — but dropping
 * alone would reinstate the very NO_WIN_CONDITION this system exists to fix, so
 * a satisfiable `score` condition is planned in their place. The user sees what
 * was substituted and why.
 */

import { registerSystem } from './registry';
import type { SystemStepInput, SystemStepContext, PlannedEntity } from './registry';
import type { GameSystem, OrchestratorGDD } from '../types';
import {
  IGNORE_WARNINGS,
  collectibleOwner,
  collectibleStep,
  readPositiveNumber,
  resolveCollectibles,
} from './collectibles';

/** A target the player can actually reach when the GDD named no number. */
export const DEFAULT_TARGET_SCORE = 10;

type ConditionKind = 'score' | 'collectAll' | 'reachGoal';

/** LLM-authored type strings arrive in every casing and punctuation. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function desiredCondition(system: GameSystem): ConditionKind {
  const type = normalize(system.type);
  const goal = typeof system.config.winCondition === 'string'
    ? normalize(system.config.winCondition)
    : '';
  const haystack = `${type} ${goal}`;

  if (haystack.includes('collect') || haystack.includes('pickup')) return 'collectAll';
  if (haystack.includes('reach') || haystack.includes('goal') || haystack.includes('exit')) {
    return 'reachGoal';
  }
  return 'score';
}

/**
 * The entity the player must reach. Role first, name only as a fallback: a GDD
 * that marks its exit as a trigger is stating intent, whereas a name match is a
 * guess.
 */
function goalOf(entities: PlannedEntity[]): PlannedEntity | undefined {
  const byRole = entities.find(e => e.entity.role === 'trigger');
  if (byRole) return byRole;
  return entities.find(e => /goal|exit|finish|flag|door|portal/i.test(e.entity.name));
}

function winConditionStep(
  ownerId: string,
  conditionType: ConditionKind,
  targetScore: number | null,
  targetEntityId: string | null,
): SystemStepInput {
  return {
    executor: 'game_component',
    input: { entityId: ownerId, type: 'winCondition', conditionType, targetScore, targetEntityId },
  };
}

/**
 * The plan-level fallback, for a GDD that declares no progression system at all.
 *
 * This module runs ONLY when `planBuilder` resolves a system whose category is
 * 'progression', and most designs never name one — so a plan built without this
 * fallback carries no win condition, `validateWinnability` answers
 * NO_WIN_CONDITION, and `gameSlice.play()` returns before dispatching anything.
 * `score` is the one condition that is satisfiable with no further structure:
 * `collectAll` needs collectibles and `reachGoal` needs a goal entity, and a
 * design that named neither would be handed a rule it can never complete.
 *
 * It lives here rather than in the builder so the default target and the step
 * shape have exactly one definition — a second hand-written copy of either is a
 * copy that drifts out of step with the condition this file plans.
 */
export function defaultWinConditionStep(ownerId: string): SystemStepInput {
  return winConditionStep(ownerId, 'score', DEFAULT_TARGET_SCORE, null);
}

registerSystem({
  category: 'progression',
  setupSteps(
    system: GameSystem,
    gdd: OrchestratorGDD,
    ctx: SystemStepContext,
  ): SystemStepInput[] {
    if (ctx.entities.length === 0) {
      ctx.warn(
        'The design asked for a progression system but placed no objects in the world, so there was nothing to win with.',
      );
      return [];
    }

    const player = ctx.entities.find(e => e.entity.role === 'player');
    // `validateWinnability` derives "there is a player" from the presence of a
    // characterController component, and the movement system is what adds one.
    // A collect-all or reach-goal condition without it is unsatisfiable no
    // matter how many collectibles exist.
    const hasControllablePlayer =
      player !== undefined && gdd.systems.some(s => s.category === 'movement');

    // The win condition is a rule about the game, not about a particular prop.
    // It rides on the player where there is one so the Inspector shows it
    // somewhere meaningful.
    const owner = player ?? ctx.entities[0];

    // The pickups and their value are resolved in one shared place, and exactly
    // one definition emits them. Where the design also declares an `entities`
    // system, THAT one emits — it is the only one that can target pickups by
    // name — and this one only reads, so its score target is derived from the
    // very components that were planned rather than from a second, independent
    // reading of the same design. Two readings is how a game ended up with a
    // target no amount of collecting could reach: `add_game_component` replaces,
    // so one value silently won while the target stayed derived from the loser.
    const owns = collectibleOwner(system, gdd) === 'progression';
    const { targets: collectibles, value: collectibleValue } = resolveCollectibles(
      system,
      gdd,
      ctx,
      // The definition that is only reading stays silent; the user should be
      // told once that a named pickup does not exist, not once per system.
      owns ? ctx.warn : IGNORE_WARNINGS,
    );

    const wanted = desiredCondition(system);
    const steps: SystemStepInput[] = [];

    // Every design here scores points off pickups, so collectibles are attached
    // regardless of which condition ends up planned.
    if (owns) {
      for (const collectible of collectibles) {
        steps.push(collectibleStep(collectible, collectibleValue));
      }
    }

    if (wanted === 'collectAll') {
      if (collectibles.length === 0) {
        ctx.warn(
          'The design asked the player to collect everything but named nothing to collect, so the game is won on points instead.',
        );
      } else if (!hasControllablePlayer) {
        ctx.warn(
          'The design asked the player to collect everything but named no player who could move to pick things up, so the game is won on points instead.',
        );
      } else {
        steps.push(winConditionStep(owner.entityId, 'collectAll', null, null));
        return steps;
      }
    }

    if (wanted === 'reachGoal') {
      const goal = goalOf(ctx.entities);
      if (!goal) {
        ctx.warn(
          'The design asked the player to reach a goal but named no goal to reach, so the game is won on points instead.',
        );
      } else if (!hasControllablePlayer) {
        ctx.warn(
          'The design asked the player to reach a goal but named no player who could move there, so the game is won on points instead.',
        );
      } else {
        // Bound to the engine id, never the name: the engine matches on the
        // `EntityId` component and a name never resolves.
        steps.push(winConditionStep(owner.entityId, 'reachGoal', null, goal.entityId));
        return steps;
      }
    }

    // Score — the fallback that is always satisfiable.
    const configured = readPositiveNumber(system.config, [
      'targetScore',
      'target_score',
      'goalScore',
      'scoreToWin',
      'targetPoints',
    ]);
    // Guard the PRODUCT, not just the factors. `readPositiveNumber` proves both
    // operands finite and that says nothing about the result — `2 * 1e308` is
    // Infinity. `gameComponentExecutor`'s schema rejects a non-finite
    // targetScore, and a rejected non-optional step fails the ENTIRE plan: the
    // exact outcome this module's drop-and-warn contract exists to avoid.
    let derived = DEFAULT_TARGET_SCORE;
    if (collectibles.length > 0) {
      const product = collectibles.length * collectibleValue;
      if (Number.isFinite(product)) {
        derived = product;
      } else {
        ctx.warn(
          `The design awarded so many points per pickup that the total could not be counted, so the game is won at ${DEFAULT_TARGET_SCORE} points instead.`,
        );
      }
    }
    const targetScore = configured ?? derived;

    if (collectibles.length === 0) {
      ctx.warn(
        `The game is won by scoring ${targetScore} points, but the design named nothing to collect, so points can only come from a script.`,
      );
    }

    steps.push(winConditionStep(owner.entityId, 'score', targetScore, null));
    return steps;
  },
});
