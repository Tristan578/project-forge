/**
 * Tests for the `progression` system definition.
 *
 * This system is the reason a generated game can be played at all: it is the
 * only thing in the pipeline that plans a `winCondition` component, and without
 * one `validateWinnability` answers NO_WIN_CONDITION and `gameSlice.play()`
 * refuses the Edit -> Play transition (PF-1199).
 *
 * Two properties are load-bearing and are asserted directly rather than
 * restated:
 *  - a condition the winnability gate would reject is never planned (the
 *    unsatisfiable variant is DROPPED, the user is warned, and a satisfiable
 *    `score` condition is planned in its place — planning nothing at all just
 *    reinstates NO_WIN_CONDITION);
 *  - the condition that IS planned passes the REAL validator, exercised by
 *    running the emitted steps through the real executor.
 */

import { describe, it, expect, vi } from 'vitest';
import { SYSTEM_REGISTRY } from '../index';
import type { SystemStepContext, SystemStepInput, PlannedEntity } from '../index';
import { EXECUTOR_REGISTRY } from '../../executors';
import { gameComponentExecutor } from '../../executors/gameComponentExecutor';
import type { ExecutorContext, GameSystem, OrchestratorGDD, EntityBlueprint } from '../../types';
import { validateWinnability } from '@/lib/playMode/winnabilityValidator';
import type { GameComponentData, SceneGraph } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(
  name: string,
  role: EntityBlueprint['role'],
): EntityBlueprint {
  return { name, role, systems: [], appearance: 'primitive:cube' };
}

function planned(entityId: string, name: string, role: EntityBlueprint['role']): PlannedEntity {
  return { entityId, scene: 'Level1', entity: makeEntity(name, role) };
}

function makeCtx(entities: PlannedEntity[], warn = vi.fn()): SystemStepContext & { warn: ReturnType<typeof vi.fn> } {
  return { entities, warn };
}

function makeSystem(type: string, config: Record<string, unknown> = {}): GameSystem {
  return { category: 'progression', type, config, priority: 'core', dependsOn: [] };
}

function makeGdd(systems: GameSystem[] = []): OrchestratorGDD {
  return {
    id: 'gdd-1',
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

/** A GDD that carries a movement system, which is what produces the player rig. */
function gddWithMovement(): OrchestratorGDD {
  return makeGdd([
    { category: 'movement', type: 'walk+jump', config: {}, priority: 'core', dependsOn: [] },
  ]);
}

function run(system: GameSystem, gdd: OrchestratorGDD, ctx: SystemStepContext): SystemStepInput[] {
  const def = SYSTEM_REGISTRY.get('progression');
  if (!def) throw new Error('progression system is not registered');
  return def.setupSteps(system, gdd, ctx);
}

/** Every win condition the steps plan, by conditionType. */
function winConditions(steps: SystemStepInput[]): Array<Record<string, unknown>> {
  return steps
    .map(s => s.input)
    .filter(input => input.type === 'winCondition');
}

/**
 * Run the planned steps through the REAL executor and collect what the store
 * would hold, so the winnability assertion below exercises the actual payloads
 * rather than a restatement of them.
 */
async function applySteps(
  steps: SystemStepInput[],
  entities: PlannedEntity[],
  extra: Record<string, GameComponentData[]> = {},
): Promise<{ components: Record<string, GameComponentData[]>; sceneGraph: SceneGraph }> {
  const components: Record<string, GameComponentData[]> = { ...extra };
  const nodes: SceneGraph['nodes'] = {};
  for (const e of entities) {
    nodes[e.entityId] = {
      entityId: e.entityId,
      name: e.entity.name,
      parentId: null,
      children: [],
      components: [],
      visible: true,
    };
  }
  const sceneGraph: SceneGraph = { nodes, rootIds: entities.map(e => e.entityId) };

  const store = {
    sceneGraph,
    addGameComponent: (entityId: string, data: GameComponentData) => {
      const existing = components[entityId] ?? [];
      components[entityId] = [...existing.filter(c => c.type !== data.type), data];
    },
  };

  const ctx = {
    dispatchCommand: vi.fn(),
    getStore: () => store as unknown as ReturnType<ExecutorContext['getStore']>,
    projectType: '3d' as const,
    userTier: 'creator' as const,
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
    resolveStepOutputs: vi.fn(() => []),
  } satisfies ExecutorContext;

  for (const step of steps) {
    expect(step.executor).toBe('game_component');
    const result = await gameComponentExecutor.execute(step.input, ctx);
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  }

  return { components, sceneGraph };
}

const CONTROLLER: GameComponentData = {
  type: 'characterController',
  characterController: {
    speed: 5,
    jumpHeight: 8,
    gravityScale: 1,
    canDoubleJump: false,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('progression system', () => {
  it('is registered', () => {
    expect(SYSTEM_REGISTRY.has('progression')).toBe(true);
  });

  it('only ever names executors that exist', () => {
    const ctx = makeCtx([planned('id-hero', 'Hero', 'player')]);
    const steps = run(makeSystem('leveling', { maxLevel: 50 }), gddWithMovement(), ctx);
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(EXECUTOR_REGISTRY.has(step.executor)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // score
  // -------------------------------------------------------------------------

  it('falls back to a satisfiable score condition for an unrecognised progression type', () => {
    const ctx = makeCtx([planned('id-hero', 'Hero', 'player')]);
    const steps = run(makeSystem('unlocking', { categories: ['crops'] }), gddWithMovement(), ctx);

    const conditions = winConditions(steps);
    expect(conditions).toHaveLength(1);
    expect(conditions[0].conditionType).toBe('score');
    expect(Number.isFinite(conditions[0].targetScore)).toBe(true);
    expect(conditions[0].targetScore as number).toBeGreaterThan(0);
  });

  it('reads an explicit target score out of the system config', () => {
    const ctx = makeCtx([planned('id-hero', 'Hero', 'player')]);
    const steps = run(makeSystem('score', { targetScore: 250 }), gddWithMovement(), ctx);

    expect(winConditions(steps)[0].targetScore).toBe(250);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Infinity],
    ['zero', 0],
    ['negative', -10],
    ['a string', '100'],
  ])('ignores a config target score that is %s and still plans a positive one', (_label, targetScore) => {
    const ctx = makeCtx([planned('id-hero', 'Hero', 'player')]);
    const steps = run(makeSystem('score', { targetScore }), gddWithMovement(), ctx);

    const condition = winConditions(steps)[0];
    expect(Number.isFinite(condition.targetScore)).toBe(true);
    expect(condition.targetScore as number).toBeGreaterThan(0);
  });

  it('warns when a score target has nothing to accrue against', () => {
    const warn = vi.fn();
    const ctx = makeCtx([planned('id-hero', 'Hero', 'player')], warn);
    run(makeSystem('score', {}), gddWithMovement(), ctx);

    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/collect/i);
  });

  // -------------------------------------------------------------------------
  // collectAll
  // -------------------------------------------------------------------------

  it('plans a collectible component per collectible entity and a collectAll condition', () => {
    const entities = [
      planned('id-hero', 'Hero', 'player'),
      planned('id-coin-1', 'Coin', 'interactable'),
      planned('id-coin-2', 'Coin', 'interactable'),
    ];
    const ctx = makeCtx(entities);
    const steps = run(makeSystem('collect-all', {}), gddWithMovement(), ctx);

    const collectibles = steps.filter(s => s.input.type === 'collectible');
    expect(collectibles.map(s => s.input.entityId).sort()).toEqual(['id-coin-1', 'id-coin-2']);

    const conditions = winConditions(steps);
    expect(conditions).toHaveLength(1);
    expect(conditions[0].conditionType).toBe('collectAll');
    // Bound to the player's engine UUID, never a name.
    expect(conditions[0].entityId).toBe('id-hero');
  });

  it('DROPS collectAll and warns when the design named nothing to collect', () => {
    const warn = vi.fn();
    const ctx = makeCtx([planned('id-hero', 'Hero', 'player')], warn);
    const steps = run(makeSystem('collect-all', {}), gddWithMovement(), ctx);

    expect(steps.some(s => s.input.conditionType === 'collectAll')).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/collect/i);
    // Something satisfiable is still planned: emitting nothing would put the
    // game back in the NO_WIN_CONDITION state this system exists to fix.
    const conditions = winConditions(steps);
    expect(conditions).toHaveLength(1);
    expect(conditions[0].conditionType).toBe('score');
  });

  it('DROPS collectAll and warns when nothing can pick the collectibles up', () => {
    const warn = vi.fn();
    const entities = [planned('id-coin-1', 'Coin', 'interactable')];
    const ctx = makeCtx(entities, warn);
    // No movement system, so no character controller will ever exist.
    const steps = run(makeSystem('collect-all', {}), makeGdd(), ctx);

    expect(steps.some(s => s.input.conditionType === 'collectAll')).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(winConditions(steps)[0].conditionType).toBe('score');
  });

  // -------------------------------------------------------------------------
  // reachGoal
  // -------------------------------------------------------------------------

  it('binds reachGoal to the goal entity UUID', () => {
    const entities = [
      planned('id-hero', 'Hero', 'player'),
      planned('id-exit', 'ExitDoor', 'trigger'),
    ];
    const ctx = makeCtx(entities);
    const steps = run(makeSystem('reach-goal', {}), gddWithMovement(), ctx);

    const condition = winConditions(steps)[0];
    expect(condition.conditionType).toBe('reachGoal');
    expect(condition.targetEntityId).toBe('id-exit');
    expect(condition.targetEntityId).not.toBe('ExitDoor');
  });

  it('DROPS reachGoal and warns when no goal entity resolves', () => {
    const warn = vi.fn();
    const ctx = makeCtx([planned('id-hero', 'Hero', 'player')], warn);
    const steps = run(makeSystem('reach-goal', {}), gddWithMovement(), ctx);

    expect(steps.some(s => s.input.conditionType === 'reachGoal')).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/goal/i);
    const conditions = winConditions(steps);
    expect(conditions).toHaveLength(1);
    expect(conditions[0].conditionType).toBe('score');
  });

  it('drops everything and warns when the design planned no entities at all', () => {
    const warn = vi.fn();
    const ctx = makeCtx([], warn);
    const steps = run(makeSystem('score', {}), makeGdd(), ctx);

    expect(steps).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // The property that actually unblocks Play
  // -------------------------------------------------------------------------

  describe('produces a scene the real winnability validator accepts', () => {
    it('for a score game', async () => {
      const entities = [
        planned('id-hero', 'Hero', 'player'),
        planned('id-coin-1', 'Coin', 'interactable'),
      ];
      const ctx = makeCtx(entities);
      const steps = run(makeSystem('score', { targetScore: 20 }), gddWithMovement(), ctx);

      const { components, sceneGraph } = await applySteps(steps, entities, {
        'id-hero': [CONTROLLER],
      });
      const report = validateWinnability(sceneGraph, components);
      expect(report.issues).toEqual([]);
      expect(report.winnable).toBe(true);
    });

    it('for a collect-all game', async () => {
      const entities = [
        planned('id-hero', 'Hero', 'player'),
        planned('id-coin-1', 'Coin', 'interactable'),
        planned('id-coin-2', 'Gem', 'interactable'),
      ];
      const ctx = makeCtx(entities);
      const steps = run(makeSystem('collect-all', {}), gddWithMovement(), ctx);

      const { components, sceneGraph } = await applySteps(steps, entities, {
        'id-hero': [CONTROLLER],
      });
      const report = validateWinnability(sceneGraph, components);
      expect(report.issues).toEqual([]);
      expect(report.winnable).toBe(true);
    });

    it('for a reach-goal game', async () => {
      const entities = [
        planned('id-hero', 'Hero', 'player'),
        planned('id-exit', 'ExitDoor', 'trigger'),
      ];
      const ctx = makeCtx(entities);
      const steps = run(makeSystem('reach-goal', {}), gddWithMovement(), ctx);

      const { components, sceneGraph } = await applySteps(steps, entities, {
        'id-hero': [CONTROLLER],
      });
      const report = validateWinnability(sceneGraph, components);
      expect(report.issues).toEqual([]);
      expect(report.winnable).toBe(true);
    });

    it('even when every requested condition had to be dropped', async () => {
      const entities = [planned('id-hero', 'Hero', 'player')];
      const ctx = makeCtx(entities);
      const steps = run(makeSystem('collect-all', {}), gddWithMovement(), ctx);

      const { components, sceneGraph } = await applySteps(steps, entities, {
        'id-hero': [CONTROLLER],
      });
      const report = validateWinnability(sceneGraph, components);
      expect(report.winnable).toBe(true);
    });
  });
});

/**
 * `readPositiveNumber` proves each operand finite, which says nothing about the
 * product: `2 * 1e308` is Infinity. `gameComponentExecutor`'s schema rejects a
 * non-finite targetScore, and a rejected non-optional step fails the WHOLE
 * plan — so an overflow here does not degrade the win condition, it destroys
 * the generated game. The contract is drop-and-warn, never emit-and-hope.
 */
describe('progression — a target score that overflows', () => {
  it('falls back to the default target and warns instead of planning Infinity', async () => {
    const warn = vi.fn();
    const entities = [
      planned('id-hero', 'Hero', 'player'),
      planned('id-coin-1', 'Coin 1', 'interactable'),
      planned('id-coin-2', 'Coin 2', 'interactable'),
    ];
    const ctx = makeCtx(entities, warn);
    const steps = run(
      makeSystem('score-attack', { collectibleValue: Number.MAX_VALUE }),
      gddWithMovement(),
      ctx,
    );

    const conditions = winConditions(steps);
    expect(conditions).toHaveLength(1);
    expect(conditions[0].conditionType).toBe('score');
    expect(Number.isFinite(conditions[0].targetScore as number)).toBe(true);
    expect(warn).toHaveBeenCalled();

    // The real executor is the authority on whether the step survives: its
    // schema is what rejects a non-finite number, and a rejected step is a
    // failed plan.
    const { components, sceneGraph } = await applySteps(steps, entities, {
      'id-hero': [CONTROLLER],
    });
    const report = validateWinnability(sceneGraph, components);
    expect(report.winnable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PF-1201 — checkpoints
// ---------------------------------------------------------------------------

/** Every checkpoint the steps plan. */
function checkpoints(steps: SystemStepInput[]): Array<Record<string, unknown>> {
  return steps.map(s => s.input).filter(input => input.type === 'checkpoint');
}

describe('progression system — checkpoints', () => {
  it('plans a checkpoint for each name the design gave', () => {
    const entities = [
      planned('id-hero', 'Hero', 'player'),
      planned('id-cp1', 'Checkpoint A', 'decoration'),
      planned('id-cp2', 'Checkpoint B', 'decoration'),
      // Something to score off, so the score branch has no warning of its own.
      planned('id-coin', 'Coin', 'interactable'),
    ];
    const ctx = makeCtx(entities);

    const steps = run(
      makeSystem('score', { checkpoints: ['Checkpoint A', 'Checkpoint B'] }),
      gddWithMovement(),
      ctx,
    );

    expect(checkpoints(steps)).toEqual([
      { entityId: 'id-cp1', type: 'checkpoint', autoSave: true },
      { entityId: 'id-cp2', type: 'checkpoint', autoSave: true },
    ]);
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  it('falls back to an unmistakable name when the design names none', () => {
    const entities = [
      planned('id-hero', 'Hero', 'player'),
      planned('id-cp', 'Respawn Point', 'decoration'),
      planned('id-rock', 'Rock', 'decoration'),
    ];

    const steps = run(makeSystem('score', {}), gddWithMovement(), makeCtx(entities));

    expect(checkpoints(steps).map(c => c.entityId)).toEqual(['id-cp']);
  });

  it('plans none when nothing in the world looks like one', () => {
    const entities = [
      planned('id-hero', 'Hero', 'player'),
      planned('id-rock', 'Rock', 'decoration'),
    ];

    const steps = run(makeSystem('score', {}), gddWithMovement(), makeCtx(entities));

    expect(checkpoints(steps)).toEqual([]);
  });

  it('DROPS the player named as a checkpoint and warns', () => {
    const entities = [
      planned('id-hero', 'Hero', 'player'),
      planned('id-cp', 'Checkpoint A', 'decoration'),
      planned('id-coin', 'Coin', 'interactable'),
    ];
    const ctx = makeCtx(entities);

    const steps = run(
      makeSystem('score', { checkpoints: ['Hero', 'Checkpoint A'] }),
      gddWithMovement(),
      ctx,
    );

    expect(checkpoints(steps).map(c => c.entityId)).toEqual(['id-cp']);
    expect(ctx.warn).toHaveBeenCalledTimes(1);
    expect(ctx.warn.mock.calls[0]?.[0]).toContain('save progress constantly');
  });

  it('DROPS a checkpoint name that resolves to nothing and warns', () => {
    const entities = [
      planned('id-hero', 'Hero', 'player'),
      planned('id-coin', 'Coin', 'interactable'),
    ];
    const ctx = makeCtx(entities);

    const steps = run(
      makeSystem('score', { savePoints: 'Ghost Checkpoint' }),
      gddWithMovement(),
      ctx,
    );

    expect(checkpoints(steps)).toEqual([]);
    expect(ctx.warn).toHaveBeenCalledTimes(1);
    expect(ctx.warn.mock.calls[0]?.[0]).toContain('Ghost Checkpoint');
  });

  it.each([
    ['score', 'score'],
    ['collect the coins', 'collectAll'],
    ['reach the exit', 'reachGoal'],
  ])('survives the %s branch, which returns before the others', (type, expectedCondition) => {
    const entities = [
      planned('id-hero', 'Hero', 'player'),
      planned('id-coin', 'Coin', 'interactable'),
      planned('id-exit', 'ExitDoor', 'trigger'),
      planned('id-cp', 'Checkpoint A', 'decoration'),
    ];

    const steps = run(makeSystem(type, {}), gddWithMovement(), makeCtx(entities));

    // Each condition branch returns early, so a checkpoint planned after the
    // branch would reach only one of the three.
    expect(winConditions(steps)[0]).toMatchObject({ conditionType: expectedCondition });
    expect(checkpoints(steps).map(c => c.entityId)).toEqual(['id-cp']);
  });

  it('plans a checkpoint bag the real executor accepts, without disturbing winnability', async () => {
    const entities = [
      planned('id-hero', 'Hero', 'player'),
      planned('id-cp', 'Checkpoint A', 'decoration'),
      planned('id-coin', 'Coin', 'interactable'),
    ];

    const steps = run(
      makeSystem('score', { checkpoints: ['Checkpoint A'] }),
      gddWithMovement(),
      makeCtx(entities),
    );
    const { components, sceneGraph } = await applySteps(steps, entities, {
      'id-hero': [CONTROLLER],
    });

    expect(components['id-cp']).toEqual([{ type: 'checkpoint', checkpoint: { autoSave: true } }]);
    expect(validateWinnability(sceneGraph, components).winnable).toBe(true);
  });
});
