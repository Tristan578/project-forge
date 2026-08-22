/**
 * A design that declares BOTH an `entities` and a `progression` system must not
 * end up unwinnable.
 *
 * Both categories attach `collectible` components, and both used to work out
 * the pickups and their value independently — different config keys, separate
 * defaults, separate target selection. `add_game_component` REPLACES, so when
 * both emitted a component for the same entity one value silently overwrote the
 * other, while `progression` kept deriving `targetScore = pickups × value` from
 * the value that may well have lost. The result is a game that starts, looks
 * correct, and can never be finished — and nothing reports it, because the
 * winnability gate checks that a condition EXISTS, not that its arithmetic
 * closes.
 *
 * These tests drive both definitions the way `planBuilder` Phase 3 does — in
 * `gdd.systems` order, steps concatenated — and then through the REAL executor,
 * whose `addGameComponent` models the same last-write-wins replacement the
 * store performs. So the assertions are about the components a generated game
 * would actually carry, not about the steps that were planned.
 */

import { describe, it, expect, vi } from 'vitest';
import { SYSTEM_REGISTRY } from '../index';
import type { SystemStepContext, SystemStepInput, PlannedEntity } from '../index';
import { gameComponentExecutor } from '../../executors/gameComponentExecutor';
import type { ExecutorContext, GameSystem, OrchestratorGDD, EntityBlueprint } from '../../types';
import type { GameComponentData } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(name: string, role: EntityBlueprint['role']): EntityBlueprint {
  return { name, role, systems: [], appearance: 'primitive:cube' };
}

function planned(entityId: string, name: string, role: EntityBlueprint['role']): PlannedEntity {
  return { entityId, scene: 'Level1', entity: makeEntity(name, role) };
}

function makeSystem(
  category: GameSystem['category'],
  type: string,
  config: Record<string, unknown> = {},
): GameSystem {
  return { category, type, config, priority: 'core', dependsOn: [] };
}

function makeGdd(systems: GameSystem[]): OrchestratorGDD {
  return {
    id: 'gdd-collectibles',
    title: 'Test Game',
    description: 'A test game',
    systems,
    scenes: [],
    assetManifest: [],
    estimatedScope: 'small',
    styleDirective: 'minimal',
    feelDirective: {
      mood: 'bright',
      pacing: 'medium',
      weight: 'medium',
      referenceGames: [],
      oneLiner: 'test',
    },
    constraints: [],
    projectType: '3d',
  };
}

/**
 * Plan every system in the design, in `gdd.systems` order — the order
 * `planBuilder` Phase 3 walks them in, and the order that decides which of two
 * components for one entity survives.
 */
function planAll(gdd: OrchestratorGDD, ctx: SystemStepContext): SystemStepInput[] {
  const steps: SystemStepInput[] = [];
  for (const system of gdd.systems) {
    const def = SYSTEM_REGISTRY.get(system.category);
    if (!def) continue;
    steps.push(...def.setupSteps(system, gdd, ctx));
  }
  return steps;
}

/** Apply the planned steps through the real executor. */
async function applySteps(
  steps: SystemStepInput[],
  entities: PlannedEntity[],
): Promise<Record<string, GameComponentData[]>> {
  const components: Record<string, GameComponentData[]> = {};
  const nodes: Record<string, { id: string }> = {};
  for (const e of entities) nodes[e.entityId] = { id: e.entityId };

  const store = {
    sceneGraph: { nodes, rootIds: [] },
    addGameComponent(entityId: string, component: GameComponentData) {
      const existing = components[entityId] ?? [];
      // The store replaces a component of the same type rather than stacking
      // two — which is exactly why a duplicate emission loses a value silently.
      components[entityId] = [...existing.filter(c => c.type !== component.type), component];
    },
  };

  const ctx = {
    dispatchCommand: vi.fn(),
    getStore: () => store as unknown as ReturnType<ExecutorContext['getStore']>,
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
    resolveStepOutputs: vi.fn(() => []),
  } satisfies ExecutorContext;

  for (const step of steps) {
    // The design declares systems this test does not care about, and they plan
    // steps for other executors. Only the component steps are applied here.
    if (step.executor !== 'game_component') continue;
    const result = await gameComponentExecutor.execute(step.input, ctx);
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  }

  return components;
}

/**
 * Every planned step of one component type, read with an indexed loop.
 *
 * `.filter` skips array holes, so a sparse step list would report a duplicate
 * emission as a single one — the direction that hides the bug under test.
 */
function stepsOfType(steps: SystemStepInput[], componentType: string): SystemStepInput[] {
  const found: SystemStepInput[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step?.executor !== 'game_component') continue;
    if (step?.input?.type === componentType) found.push(step);
  }
  return found;
}

function componentOfType(
  components: Record<string, GameComponentData[]>,
  entityId: string,
  type: string,
): GameComponentData | undefined {
  const list = components[entityId] ?? [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i]?.type === type) return list[i];
  }
  return undefined;
}

/** The most a player could possibly score off the components that were planned. */
function reachableScore(components: Record<string, GameComponentData[]>): number {
  let total = 0;
  for (const list of Object.values(components)) {
    for (let i = 0; i < list.length; i += 1) {
      const component = list[i];
      if (component?.type !== 'collectible') continue;
      const value = (component as { collectible?: { value?: number } }).collectible?.value;
      if (typeof value === 'number' && Number.isFinite(value)) total += value;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------

describe('a design that declares both an entities and a progression system', () => {
  const ENTITIES = [
    planned('uuid-player', 'Hero', 'player'),
    planned('uuid-coin', 'Gold Coin', 'interactable'),
    planned('uuid-gem', 'Ruby Gem', 'interactable'),
  ];

  /**
   * The shape that shipped the bug: each system names its own points-per-pickup,
   * and they disagree.
   */
  function conflictingDesign(): OrchestratorGDD {
    return makeGdd([
      makeSystem('movement', 'platformer', {}),
      makeSystem('entities', 'pickups', { value: 25 }),
      makeSystem('progression', 'score', { collectibleValue: 5 }),
    ]);
  }

  it('attaches exactly one collectible component per pickup, planned once', async () => {
    const gdd = conflictingDesign();
    const ctx: SystemStepContext = { entities: ENTITIES, warn: vi.fn() };

    const steps = planAll(gdd, ctx);

    // One step per pickup across BOTH systems. Two steps for one entity is the
    // defect: the second silently discards the first's value.
    const collectibleSteps = stepsOfType(steps, 'collectible');
    expect(collectibleSteps.map(s => s.input.entityId).sort()).toEqual(['uuid-coin', 'uuid-gem']);

    const components = await applySteps(steps, ENTITIES);
    expect(componentOfType(components, 'uuid-coin', 'collectible')).toBeDefined();
    expect(componentOfType(components, 'uuid-gem', 'collectible')).toBeDefined();
  });

  it('scores every pickup at the value the design wrote, not a second reading of it', async () => {
    const gdd = conflictingDesign();
    const ctx: SystemStepContext = { entities: ENTITIES, warn: vi.fn() };

    const components = await applySteps(planAll(gdd, ctx), ENTITIES);

    // `entities` owns the pickups — it is the only definition that can target
    // them by name — so its number is the one that reaches the game, and the
    // progression system reads that same number rather than its own.
    for (const entityId of ['uuid-coin', 'uuid-gem']) {
      const component = componentOfType(components, entityId, 'collectible');
      expect((component as { collectible: { value: number } }).collectible.value).toBe(25);
    }
  });

  it('sets a target the player can actually reach', async () => {
    const gdd = conflictingDesign();
    const ctx: SystemStepContext = { entities: ENTITIES, warn: vi.fn() };

    const components = await applySteps(planAll(gdd, ctx), ENTITIES);

    const win = componentOfType(components, 'uuid-player', 'winCondition');
    const targetScore = (win as { winCondition: { targetScore: number | null } })
      .winCondition.targetScore;

    expect(targetScore).toBe(50);
    // The property that matters, stated independently of the number above: a
    // target above everything in the level is a game that cannot be finished.
    expect(targetScore as number).toBeLessThanOrEqual(reachableScore(components));
  });

  it('derives the target from the pickups the design NAMED, not from every interactable', async () => {
    const gdd = makeGdd([
      makeSystem('movement', 'platformer', {}),
      makeSystem('entities', 'pickups', { collectibles: ['Gold Coin'], value: 10 }),
      makeSystem('progression', 'score', {}),
    ]);
    const ctx: SystemStepContext = { entities: ENTITIES, warn: vi.fn() };

    const steps = planAll(gdd, ctx);
    expect(stepsOfType(steps, 'collectible').map(s => s.input.entityId)).toEqual(['uuid-coin']);

    const components = await applySteps(steps, ENTITIES);
    const win = componentOfType(components, 'uuid-player', 'winCondition');
    const targetScore = (win as { winCondition: { targetScore: number | null } })
      .winCondition.targetScore;

    // The Ruby Gem is interactable but was not named, so it is not a pickup and
    // must not be counted toward the goal.
    expect(targetScore).toBe(10);
    expect(targetScore as number).toBeLessThanOrEqual(reachableScore(components));
  });

  it('takes the points-per-pickup from whichever system carried the number', async () => {
    // The design put the name list on one system and the value on the other.
    // Ignoring the value because it was written on the "wrong" system would be
    // inventing a number the design never asked for.
    const gdd = makeGdd([
      makeSystem('movement', 'platformer', {}),
      makeSystem('entities', 'pickups', { collectibles: ['Gold Coin', 'Ruby Gem'] }),
      makeSystem('progression', 'score', { pointsPerPickup: 7 }),
    ]);
    const ctx: SystemStepContext = { entities: ENTITIES, warn: vi.fn() };

    const components = await applySteps(planAll(gdd, ctx), ENTITIES);

    const coin = componentOfType(components, 'uuid-coin', 'collectible');
    expect((coin as { collectible: { value: number } }).collectible.value).toBe(7);

    const win = componentOfType(components, 'uuid-player', 'winCondition');
    const targetScore = (win as { winCondition: { targetScore: number | null } })
      .winCondition.targetScore;
    expect(targetScore).toBe(14);
    expect(targetScore as number).toBeLessThanOrEqual(reachableScore(components));
  });

  it('explains a missing pickup once, not once per system that looked for it', () => {
    const gdd = makeGdd([
      makeSystem('movement', 'platformer', {}),
      makeSystem('entities', 'pickups', { collectibles: ['Gold Coin', 'Mythril Ingot'] }),
      makeSystem('progression', 'score', {}),
    ]);
    const warn = vi.fn();
    const ctx: SystemStepContext = { entities: ENTITIES, warn };

    planAll(gdd, ctx);

    const aboutMythril = warn.mock.calls.filter(call => String(call[0]).includes('Mythril Ingot'));
    expect(aboutMythril).toHaveLength(1);
  });

  it('still plans the pickups when the design declares progression alone', async () => {
    const gdd = makeGdd([
      makeSystem('movement', 'platformer', {}),
      makeSystem('progression', 'score', { collectibleValue: 5 }),
    ]);
    const ctx: SystemStepContext = { entities: ENTITIES, warn: vi.fn() };

    const steps = planAll(gdd, ctx);
    expect(stepsOfType(steps, 'collectible').map(s => s.input.entityId).sort())
      .toEqual(['uuid-coin', 'uuid-gem']);

    const components = await applySteps(steps, ENTITIES);
    const win = componentOfType(components, 'uuid-player', 'winCondition');
    const targetScore = (win as { winCondition: { targetScore: number | null } })
      .winCondition.targetScore;

    expect(targetScore).toBe(10);
    expect(targetScore as number).toBeLessThanOrEqual(reachableScore(components));
  });
});
