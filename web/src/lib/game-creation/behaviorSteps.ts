/**
 * Turns the per-entity `behavior` the GDD carries into plan steps (PF-1114).
 *
 * This is the half of the ticket the vocabulary alone does not deliver: a verb
 * on a blueprint that no stage reads is exactly the shape PF-1111 deleted. Every
 * entry in `BEHAVIOR_VOCAB` either produces a step here or is documented as
 * producing none.
 *
 * OWNERSHIP — read before adding a second writer.
 *
 * `systems/challenge.ts` plans a `follower` for EVERY `role: 'enemy'` entity by
 * default whenever the GDD declares a `challenge` system. Emitting a second
 * chase source per entity is not a feature, it is two writers racing for one
 * component. The decision is: **an entity that carries an explicit `behavior`
 * is owned HERE**, and `planFollowers` / `planMovingPlatforms` skip it (see
 * `hasAuthoredBehavior` at their call sites). Per-entity intent is more
 * specific than a system-level default, and the design that bothered to say
 * "this one patrols" should not be overruled by "all enemies chase".
 *
 * That rule runs BOTH ways, and the second direction is the one that is easy
 * to forget. Per-entity intent beats a system-level DEFAULT, but it does not
 * beat a system naming this entity EXPLICITLY: an entity the challenge system's
 * `spawners` list points at by name is claimed, and this pass yields to it (see
 * `spawnerEntityIdsFor`). Without that half, an entity named as a spawner and
 * given a `behavior` came out carrying `SpawnerData` and `FollowerData` at
 * once — a nest that walks away from the enemies it is producing.
 *
 * The tuning still comes from the challenge system where there is one
 * (`chaseTuningFor`, `patrolTuningFor`), so an explicit `behavior` does not
 * silently discard the `chaseSpeed` or `platformSpeed` the same design asked
 * for.
 */

import type { OrchestratorGDD, ExecutorName } from './types';
import type { PlannedEntity } from './systems';
import {
  chaseTuningFor,
  patrolTuningFor,
  travelsVertically,
  spawnerEntityIdsFor,
} from './systems';
import { BEHAVIOR_PLANS } from './behaviorVocabulary';
import type { Behavior } from './behaviorVocabulary';

/** The same `{ executor, input }` shape the system registry emits. */
export interface BehaviorStepInput {
  executor: ExecutorName;
  input: Record<string, unknown>;
}

/**
 * How far a patrol route travels, and how it is shaped.
 *
 * Waypoints are OFFSETS from where the entity spawned — `system_moving_platform`
 * computes `origin + waypoint` — so `[0, 0, 0]` first means "start where the
 * design placed me". A world-space route would teleport every patroller to the
 * origin on its first frame. Same convention as `systems/challenge.ts`.
 *
 * The speed, pause and distance themselves come from `patrolTuningFor`, not
 * from constants here: the challenge system reads `platformSpeed`/`moveSpeed`,
 * `pauseDuration` and `distance` off the same GDD, and hardcoding them here
 * would silently discard a route the same design asked for — the defect
 * `chaseTuningFor` already closes on the chase side.
 */

/**
 * The entity a behaviour reacts to.
 *
 * Every targeted behaviour in the vocabulary today targets the player, so this
 * resolves the player and nothing else. Same-scene first: two scenes each with
 * their own player must not cross-bind, because the engine would match the id
 * fine and the enemy would chase something that is not in the level.
 */
function resolveTarget(
  self: PlannedEntity,
  entities: PlannedEntity[],
): PlannedEntity | null {
  let fallback: PlannedEntity | null = null;
  for (let i = 0; i < entities.length; i += 1) {
    const candidate = entities[i];
    if (!candidate) continue;
    if (candidate.entity.role !== 'player') continue;
    if (candidate.entityId === self.entityId) continue;
    if (candidate.scene === self.scene) return candidate;
    fallback ??= candidate;
  }
  return fallback;
}

function followerStep(
  entity: PlannedEntity,
  targetEntityId: string,
  speed: number,
  stopDistance: number,
): BehaviorStepInput {
  return {
    executor: 'game_component',
    input: {
      entityId: entity.entityId,
      type: 'follower',
      targetEntityId,
      speed,
      stopDistance,
      lookAtTarget: true,
    },
  };
}

function patrolStep(
  entity: PlannedEntity,
  tuning: { speed: number; pauseDuration: number; distance: number },
): BehaviorStepInput {
  // An "Elevator" patrols UP, not across — the same signal `planMovingPlatforms`
  // reads, off the same shared predicate.
  const vertical = travelsVertically(entity.entity.name);
  return {
    executor: 'game_component',
    input: {
      entityId: entity.entityId,
      type: 'movingPlatform',
      speed: tuning.speed,
      // Offsets, not world positions. See the note above.
      waypoints: [
        [0, 0, 0],
        vertical ? [0, tuning.distance, 0] : [tuning.distance, 0, 0],
      ],
      pauseDuration: tuning.pauseDuration,
      // Back and forth: a patrol that walks one way and stops is a patroller
      // standing at the far end of the level for the rest of the game.
      loopMode: 'pingPong',
    },
  };
}

function scriptStep(
  entity: PlannedEntity,
  behavior: Behavior,
  targetEntityId: string | null,
  projectType: '2d' | '3d',
): BehaviorStepInput {
  return {
    executor: 'behavior_script',
    input: {
      behavior,
      entityId: entity.entityId,
      targetEntityId,
      projectType,
    },
  };
}

/**
 * One step (or none) per entity that carries a behaviour.
 *
 * Indexed loops throughout: a callback form skips array holes, and a skipped
 * entity here is an entity that silently does nothing in the finished game —
 * the exact failure this ticket exists to end.
 */
export function planBehaviorSteps(
  gdd: OrchestratorGDD,
  entities: PlannedEntity[],
  warn: (message: string) => void,
): BehaviorStepInput[] {
  const steps: BehaviorStepInput[] = [];
  const chase = chaseTuningFor(gdd);
  const patrol = patrolTuningFor(gdd);
  // The other half of the ownership rule. Per-entity intent beats a system
  // DEFAULT (that is the skip in `planFollowers` / `planMovingPlatforms`), but
  // it does not beat a system naming this entity explicitly: a spawner is a
  // thing the design pointed at by name, and giving it a `follower` too puts
  // `SpawnerData` and `FollowerData` on one body — the walking nest
  // `planSpawners`' `excluded` set exists to prevent.
  const spawners = spawnerEntityIdsFor(gdd, entities);

  for (let i = 0; i < entities.length; i += 1) {
    const planned = entities[i];
    if (!planned) continue;
    const behavior = planned.entity.behavior;
    if (behavior === undefined) continue;

    const plan = BEHAVIOR_PLANS[behavior];
    if (plan.substrate === 'none') continue;

    if (spawners.has(planned.entityId)) {
      // Said out loud rather than dropped: the design asked for two things that
      // cannot both be true of one object, and the user would otherwise be left
      // wondering why the nest stands still.
      warn(
        `"${planned.entity.name}" was designed so that it ${plan.summary}, but the design also named it as a spawner. One object cannot both be the nest and act like what comes out of it, so it was left as a spawner.`,
      );
      continue;
    }

    let targetEntityId: string | null = null;
    if (plan.needsTarget) {
      const target = resolveTarget(planned, entities);
      if (!target) {
        // Said out loud rather than dropped: an enemy designed to hunt with
        // nothing to hunt stands exactly where it spawned, and the user would
        // otherwise be left guessing why.
        warn(
          `"${planned.entity.name}" was designed so that it ${plan.summary}, but the design placed no player for it to react to, so it was left standing still.`,
        );
        continue;
      }
      targetEntityId = target.entityId;
    }

    if (plan.substrate === 'game_component') {
      if (plan.component === 'follower') {
        // Narrowed by `needsTarget: true` on the chase plan; restated so a
        // future plan with `needsTarget: false` cannot bind a null target.
        if (targetEntityId === null) continue;
        steps.push(followerStep(planned, targetEntityId, chase.speed, chase.stopDistance));
      } else {
        steps.push(patrolStep(planned, patrol));
      }
      continue;
    }

    steps.push(scriptStep(planned, behavior, targetEntityId, gdd.projectType));
  }

  return steps;
}
