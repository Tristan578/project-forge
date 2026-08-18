/**
 * Tests for the `entities` system definition.
 *
 * A generated game whose entities carry no gameplay components is a room with
 * a player in it: nothing can be picked up, so nothing scores, so the score
 * win condition the progression system plans can never be met (PF-1199).
 *
 * Two properties are load-bearing and asserted directly:
 *  - a component is only ever bound to an engine UUID taken from
 *    `ctx.entities`. The engine matches on the `EntityId` component and its
 *    match loops emit nothing when nothing matches, so a step bound to a name
 *    is a silent no-op — `dispatchCommand` returns void and reports nothing.
 *    A name the GDD invented that resolves to no planned entity is therefore
 *    DROPPED with a warning rather than planned as a step certain to fail.
 *  - the payloads that ARE planned pass the real executor, which is exercised
 *    here rather than restated.
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

function makeCtx(
  entities: PlannedEntity[],
  warn = vi.fn(),
): SystemStepContext & { warn: ReturnType<typeof vi.fn> } {
  return { entities, warn };
}

function makeSystem(type: string, config: Record<string, unknown> = {}): GameSystem {
  return { category: 'entities', type, config, priority: 'core', dependsOn: [] };
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

function run(system: GameSystem, gdd: OrchestratorGDD, ctx: SystemStepContext): SystemStepInput[] {
  const def = SYSTEM_REGISTRY.get('entities');
  if (!def) throw new Error('entities system is not registered');
  return def.setupSteps(system, gdd, ctx);
}

/**
 * Run the planned steps through the REAL executor, so the payload assertions
 * exercise the actual component the store would receive rather than a
 * restatement of the step input.
 */
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
  } satisfies ExecutorContext;

  for (const step of steps) {
    expect(step.executor).toBe('game_component');
    const result = await gameComponentExecutor.execute(step.input, ctx);
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  }

  return components;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('entities system', () => {
  it('is registered under the category the plan builder resolves', () => {
    expect(SYSTEM_REGISTRY.has('entities')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('turns the entities the system names into collectibles bound to their engine ids', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-coin', 'Gold Coin', 'interactable'),
      planned('uuid-gem', 'Ruby Gem', 'interactable'),
    ];
    const ctx = makeCtx(entities);

    const steps = run(
      makeSystem('pickups', { collectibles: ['Gold Coin', 'Ruby Gem'], value: 25 }),
      makeGdd(),
      ctx,
    );

    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual({
      executor: 'game_component',
      input: {
        entityId: 'uuid-coin',
        type: 'collectible',
        value: 25,
        destroyOnCollect: true,
        pickupSoundAsset: null,
        rotateSpeed: 90,
      },
    });
    expect(steps[1].input.entityId).toBe('uuid-gem');
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  it('matches a named entity regardless of casing and punctuation', () => {
    const entities = [planned('uuid-coin', 'Gold Coin', 'interactable')];
    const ctx = makeCtx(entities);

    const steps = run(makeSystem('pickups', { pickups: ['gold-coin'] }), makeGdd(), ctx);

    expect(steps).toHaveLength(1);
    expect(steps[0].input.entityId).toBe('uuid-coin');
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  it('falls back to the interactable entities when the system names none', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-coin', 'Coin', 'interactable'),
      planned('uuid-tree', 'Tree', 'decoration'),
    ];
    const ctx = makeCtx(entities);

    const steps = run(makeSystem('collectibles', {}), makeGdd(), ctx);

    expect(steps.map(s => s.input.entityId)).toEqual(['uuid-coin']);
  });

  it('plans a complete collectible bag the real executor accepts', async () => {
    const entities = [planned('uuid-coin', 'Coin', 'interactable')];
    const steps = run(makeSystem('pickups', { value: 7 }), makeGdd(), makeCtx(entities));

    const components = await applySteps(steps, entities);

    expect(components).toEqual({
      'uuid-coin': [
        {
          type: 'collectible',
          collectible: {
            value: 7,
            destroyOnCollect: true,
            pickupSoundAsset: null,
            rotateSpeed: 90,
          },
        },
      ],
    });
  });

  // -------------------------------------------------------------------------
  // Drop-and-warn
  // -------------------------------------------------------------------------

  it('DROPS a named entity that resolves to nothing and warns instead', () => {
    const entities = [planned('uuid-coin', 'Coin', 'interactable')];
    const ctx = makeCtx(entities);

    const steps = run(
      makeSystem('pickups', { collectibles: ['Coin', 'Mythril Ingot'] }),
      makeGdd(),
      ctx,
    );

    // The step for the unresolvable name is ABSENT — not planned with the name
    // as an id, which the engine would silently ignore.
    expect(steps).toHaveLength(1);
    expect(steps[0].input.entityId).toBe('uuid-coin');
    expect(steps.some(s => JSON.stringify(s.input).includes('Mythril'))).toBe(false);
    expect(ctx.warn).toHaveBeenCalledTimes(1);
    expect(ctx.warn.mock.calls[0][0]).toContain('Mythril Ingot');
  });

  it('warns and plans nothing when every named entity is unresolvable', () => {
    const entities = [planned('uuid-player', 'Hero', 'player')];
    const ctx = makeCtx(entities);

    const steps = run(makeSystem('pickups', { collectibles: ['Ghost Coin'] }), makeGdd(), ctx);

    expect(steps).toEqual([]);
    expect(ctx.warn).toHaveBeenCalled();
  });

  it('DROPS the player when the design names it as a pickup', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-coin', 'Coin', 'interactable'),
    ];
    const ctx = makeCtx(entities);

    const steps = run(makeSystem('pickups', { collectibles: ['Hero', 'Coin'] }), makeGdd(), ctx);

    expect(steps.map(s => s.input.entityId)).toEqual(['uuid-coin']);
    expect(ctx.warn).toHaveBeenCalledTimes(1);
    expect(ctx.warn.mock.calls[0][0]).toContain('Hero');
  });

  it('warns and plans nothing when the world holds no entities at all', () => {
    const ctx = makeCtx([]);

    const steps = run(makeSystem('pickups', {}), makeGdd(), ctx);

    expect(steps).toEqual([]);
    expect(ctx.warn).toHaveBeenCalled();
  });

  it('warns and plans nothing when nothing in the world can be picked up', () => {
    const ctx = makeCtx([
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-tree', 'Tree', 'decoration'),
    ]);

    const steps = run(makeSystem('pickups', {}), makeGdd(), ctx);

    expect(steps).toEqual([]);
    expect(ctx.warn).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // LLM-authored config
  // -------------------------------------------------------------------------

  it.each([
    ['not a number', 'lots'],
    ['zero', 0],
    ['negative', -5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('ignores a config value that is %s and uses the default', (_label, value) => {
    const entities = [planned('uuid-coin', 'Coin', 'interactable')];

    const steps = run(makeSystem('pickups', { value }), makeGdd(), makeCtx(entities));

    expect(steps[0].input.value).toBe(10);
  });

  it('reads the config with Object.hasOwn, not a bare index', () => {
    const entities = [planned('uuid-coin', 'Coin', 'interactable')];
    // `config['constructor']` resolves on the prototype chain to a function; a
    // bare read of a key the object does not own would hand one back.
    const config = Object.create({ value: 999 }) as Record<string, unknown>;

    const steps = run(makeSystem('pickups', config), makeGdd(), makeCtx(entities));

    expect(steps[0].input.value).toBe(10);
  });

  it('accepts a comma-separated string of names as well as an array', () => {
    const entities = [
      planned('uuid-coin', 'Coin', 'interactable'),
      planned('uuid-gem', 'Gem', 'interactable'),
    ];
    const ctx = makeCtx(entities);

    const steps = run(makeSystem('pickups', { collectibles: 'Coin, Gem' }), makeGdd(), ctx);

    expect(steps.map(s => s.input.entityId)).toEqual(['uuid-coin', 'uuid-gem']);
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  it('plans one step per entity even when a name is repeated', () => {
    const entities = [planned('uuid-coin', 'Coin', 'interactable')];

    const steps = run(makeSystem('pickups', { collectibles: ['Coin', 'coin'] }), makeGdd(), makeCtx(entities));

    expect(steps).toHaveLength(1);
  });
});
