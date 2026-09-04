/**
 * The closed behaviour vocabulary and the steps it plans (PF-1114).
 *
 * The ticket's first acceptance criterion is that the vocabulary is CLOSED and
 * that every entry has somewhere to go. Two failure modes are specifically
 * guarded here, because both would pass a naive "does it compile" check:
 *
 *  - a verb added to `BEHAVIOR_VOCAB` that the planner ignores, which is an
 *    entity standing still while the design says it hunts you;
 *  - a behaviour script that reaches for `forge.physics.*` on an enemy.
 *    `physicsRoles.ts` gives enemies and NPCs `bodyType: 'fixed'` with
 *    `isSensor: true`, so applyForce, applyImpulse and setVelocity are silent
 *    no-ops on them — the exact class of failure this ticket exists to end.
 */

import { describe, it, expect } from 'vitest';
import {
  BEHAVIOR_PLANS,
  BEHAVIOR_VOCAB,
  behaviorPromptLines,
  hasAuthoredBehavior,
  isBehavior,
  zBehavior,
} from '@/lib/game-creation/behaviorVocabulary';
import { planBehaviorSteps } from '@/lib/game-creation/behaviorSteps';
import type { PlannedEntity } from '@/lib/game-creation/systems';
import type { Behavior } from '@/lib/game-creation/behaviorVocabulary';
import type { EntityRole, GameSystem, OrchestratorGDD } from '@/lib/game-creation/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(
  name: string,
  role: EntityRole,
  behavior?: Behavior,
  scene = 'Main',
): PlannedEntity {
  return {
    entityId: `id-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
    scene,
    entity: { name, role, systems: [], appearance: 'primitive:cube', behavior },
  };
}

function makeGdd(systems: GameSystem[] = [], projectType: '2d' | '3d' = '3d'): OrchestratorGDD {
  return {
    id: 'gdd-behavior',
    title: 'Behavior Test',
    description: 'a game whose entities do things',
    systems,
    scenes: [],
    assetManifest: [],
    estimatedScope: 'small',
    styleDirective: 'minimal',
    feelDirective: {
      mood: 'neutral',
      pacing: 'medium',
      weight: 'medium',
      referenceGames: [],
      oneLiner: 'a test game',
    },
    constraints: [],
    projectType,
  };
}

function plan(
  entities: PlannedEntity[],
  gdd: OrchestratorGDD = makeGdd(),
): { steps: ReturnType<typeof planBehaviorSteps>; warnings: string[] } {
  const warnings: string[] = [];
  const steps = planBehaviorSteps(gdd, entities, message => warnings.push(message));
  return { steps, warnings };
}

// ---------------------------------------------------------------------------

describe('behaviour vocabulary', () => {
  it('is exactly the closed set the ticket specified', () => {
    expect([...BEHAVIOR_VOCAB]).toEqual(['chase', 'patrol', 'flee', 'idle', 'projectile_fire']);
  });

  it('accepts every vocabulary entry and rejects anything else', () => {
    for (const behavior of BEHAVIOR_VOCAB) {
      expect(zBehavior.safeParse(behavior).success).toBe(true);
    }
    // The removed shape (free text) and a plausible near-miss.
    expect(zBehavior.safeParse('teleport-and-explode').success).toBe(false);
    expect(zBehavior.safeParse('chase-player').success).toBe(false);
    expect(zBehavior.safeParse('').success).toBe(false);
    expect(zBehavior.safeParse(['chase']).success).toBe(false);
  });

  it('gives every entry a plan, and every targeted plan a reason to need one', () => {
    // `Record<Behavior, BehaviorPlan>` makes a missing entry a compile error;
    // this walks the same table at runtime so an entry that exists but is
    // internally inconsistent (a script substrate with no summary, say) is
    // caught too.
    for (const behavior of BEHAVIOR_VOCAB) {
      const entry = BEHAVIOR_PLANS[behavior];
      expect(entry).toBeDefined();
      expect(entry.summary.length).toBeGreaterThan(0);
      if (entry.substrate === 'none') {
        expect(entry.needsTarget).toBe(false);
      }
    }
    expect(Object.keys(BEHAVIOR_PLANS).sort()).toEqual([...BEHAVIOR_VOCAB].sort());
  });

  it('prefers an engine component wherever the engine has one', () => {
    // The substrate decision is the architectural choice this ticket made, so
    // flipping one to a generated script should be deliberate, not incidental.
    expect(BEHAVIOR_PLANS.chase).toMatchObject({ substrate: 'game_component', component: 'follower' });
    expect(BEHAVIOR_PLANS.patrol).toMatchObject({
      substrate: 'game_component',
      component: 'movingPlatform',
    });
    expect(BEHAVIOR_PLANS.idle.substrate).toBe('none');
    expect(BEHAVIOR_PLANS.flee.substrate).toBe('behavior_script');
    expect(BEHAVIOR_PLANS.projectile_fire.substrate).toBe('behavior_script');
  });

  it('documents every entry for the model, one line each', () => {
    const lines = behaviorPromptLines();
    expect(lines).toHaveLength(BEHAVIOR_VOCAB.length);
    for (const behavior of BEHAVIOR_VOCAB) {
      expect(lines.some(line => line.includes(`"${behavior}"`))).toBe(true);
    }
  });

  it('narrows unknown values', () => {
    expect(isBehavior('chase')).toBe(true);
    expect(isBehavior('chase-player')).toBe(false);
    expect(isBehavior(undefined)).toBe(false);
    expect(isBehavior(7)).toBe(false);
  });

  it('reports whether a blueprint carries a behaviour of its own', () => {
    expect(hasAuthoredBehavior({ behavior: 'idle' })).toBe(true);
    expect(hasAuthoredBehavior({})).toBe(false);
  });
});

describe('planBehaviorSteps', () => {
  it('plans nothing for entities that carry no behaviour', () => {
    const { steps, warnings } = plan([
      makeEntity('Player', 'player'),
      makeEntity('Crate', 'decoration'),
    ]);
    expect(steps).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('chase becomes a follower bound to the player engine id', () => {
    const player = makeEntity('Player', 'player');
    const { steps } = plan([player, makeEntity('Bat', 'enemy', 'chase')]);

    expect(steps).toHaveLength(1);
    expect(steps[0].executor).toBe('game_component');
    expect(steps[0].input).toMatchObject({
      type: 'follower',
      entityId: 'id-bat',
      // The MINTED id, never the authored name: the engine matches components
      // on the EntityId component and emits nothing on a miss.
      targetEntityId: player.entityId,
      lookAtTarget: true,
    });
  });

  it('chase takes the speed the challenge system asked for', () => {
    const gdd = makeGdd([
      {
        category: 'challenge',
        type: 'pursuit',
        config: { chaseSpeed: 9, stopDistance: 4 },
        priority: 'core',
        dependsOn: [],
      },
    ]);
    const { steps } = plan([makeEntity('Player', 'player'), makeEntity('Bat', 'enemy', 'chase')], gdd);

    expect(steps[0].input).toMatchObject({ speed: 9, stopDistance: 4 });
  });

  it('patrol becomes a moving platform whose waypoints are OFFSETS from the spawn', () => {
    const { steps } = plan([makeEntity('Guard', 'enemy', 'patrol')]);

    expect(steps).toHaveLength(1);
    expect(steps[0].input).toMatchObject({ type: 'movingPlatform', loopMode: 'pingPong' });
    // `system_moving_platform` computes origin + waypoint, so the first point
    // must be the zero offset. A world-space route teleports the patroller to
    // the origin on its first frame.
    expect(steps[0].input.waypoints).toEqual([
      [0, 0, 0],
      [4, 0, 0],
    ]);
  });

  it('patrol needs no player', () => {
    const { steps, warnings } = plan([makeEntity('Guard', 'enemy', 'patrol')]);
    expect(steps).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it('idle plans nothing at all — not an empty script', () => {
    const { steps, warnings } = plan([
      makeEntity('Player', 'player'),
      makeEntity('Statue', 'decoration', 'idle'),
    ]);
    expect(steps).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('flee and projectile_fire become behavior_script steps carrying the target', () => {
    const player = makeEntity('Player', 'player');
    const { steps } = plan([
      player,
      makeEntity('Rabbit', 'npc', 'flee'),
      makeEntity('Turret', 'enemy', 'projectile_fire'),
    ]);

    expect(steps.map(s => s.executor)).toEqual(['behavior_script', 'behavior_script']);
    expect(steps[0].input).toMatchObject({
      behavior: 'flee',
      entityId: 'id-rabbit',
      targetEntityId: player.entityId,
      projectType: '3d',
    });
    expect(steps[1].input).toMatchObject({ behavior: 'projectile_fire', entityId: 'id-turret' });
  });

  it('carries the project type through, so 2D behaviours move on the 2D plane', () => {
    const { steps } = plan(
      [makeEntity('Player', 'player'), makeEntity('Rabbit', 'npc', 'flee')],
      makeGdd([], '2d'),
    );
    expect(steps[0].input.projectType).toBe('2d');
  });

  it('drops a targeted behaviour with no player and SAYS SO', () => {
    const { steps, warnings } = plan([makeEntity('Bat', 'enemy', 'chase')]);

    expect(steps).toEqual([]);
    // Silently dropping it is the failure mode: the user gets an enemy that
    // stands still with nothing anywhere explaining why.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Bat');
    expect(warnings[0]).toContain('no player');
  });

  it('never binds a behaviour to the entity carrying it', () => {
    // A player marked `chase` would otherwise resolve itself as the target,
    // and `gameComponentExecutor` refuses a follower that chases itself — the
    // whole plan would fail on a design error nothing warned about.
    const { steps, warnings } = plan([makeEntity('Player', 'player', 'chase')]);
    expect(steps).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it('binds to the player in the SAME scene when scenes each have one', () => {
    const here = makeEntity('Player One', 'player', undefined, 'Level 1');
    const there = makeEntity('Player Two', 'player', undefined, 'Level 2');
    const enemy = makeEntity('Bat', 'enemy', 'chase', 'Level 2');

    const { steps } = plan([here, enemy, there]);
    expect(steps[0].input.targetEntityId).toBe(there.entityId);
  });

  it('plans a step for every behaviour that has a substrate', () => {
    // Iterating the vocabulary rather than listing verbs: a new entry that the
    // planner silently ignores fails HERE rather than shipping as an entity
    // that does nothing.
    for (const behavior of BEHAVIOR_VOCAB) {
      const { steps } = plan([
        makeEntity('Player', 'player'),
        makeEntity('Actor', 'enemy', behavior),
      ]);
      const expected = BEHAVIOR_PLANS[behavior].substrate === 'none' ? 0 : 1;
      expect({ behavior, count: steps.length }).toEqual({ behavior, count: expected });
    }
  });
});
