/**
 * Tests for the `challenge` system definition.
 *
 * Without it a generated game has hazards that are scenery: the design names
 * spikes and enemies, the pipeline spawns them, and touching one does nothing
 * (PF-1199).
 *
 * The two properties asserted directly:
 *  - a `damageZone` is only ever bound to an engine UUID from `ctx.entities`.
 *    A name the GDD invented that resolves to no planned entity is DROPPED
 *    with a warning, because the engine's match loop emits nothing when
 *    nothing matches and `dispatchCommand` returns void — a step bound to a
 *    name would fail in complete silence.
 *  - the player's `health` is planned here ONLY when no health-shaped feedback
 *    system already plans one, so the two systems never both write it.
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
  return { category: 'challenge', type, config, priority: 'core', dependsOn: [] };
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

/** A GDD whose feedback system is the one that plans health. */
function gddWithHealthFeedback(config: Record<string, unknown> = {}): OrchestratorGDD {
  return makeGdd([
    { category: 'feedback', type: 'health_and_damage', config, priority: 'core', dependsOn: [] },
  ]);
}

function run(system: GameSystem, gdd: OrchestratorGDD, ctx: SystemStepContext): SystemStepInput[] {
  const def = SYSTEM_REGISTRY.get('challenge');
  if (!def) throw new Error('challenge system is not registered');
  return def.setupSteps(system, gdd, ctx);
}

function inputsOfType(steps: SystemStepInput[], type: string): Array<Record<string, unknown>> {
  return steps.map(s => s.input).filter(input => input.type === type);
}

/** Run the planned steps through the REAL executor. */
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

describe('challenge system', () => {
  it('is registered under the category the plan builder resolves', () => {
    expect(SYSTEM_REGISTRY.has('challenge')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('turns the hazards the system names into damage zones bound to their engine ids', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-spikes', 'Spike Pit', 'decoration'),
      planned('uuid-saw', 'Buzz Saw', 'decoration'),
    ];
    const ctx = makeCtx(entities);

    const steps = run(
      makeSystem('hazards', { hazards: ['Spike Pit', 'Buzz Saw'], damage: 40 }),
      makeGdd(),
      ctx,
    );

    const zones = inputsOfType(steps, 'damageZone');
    expect(zones).toEqual([
      { entityId: 'uuid-spikes', type: 'damageZone', damagePerSecond: 40, oneShot: false },
      { entityId: 'uuid-saw', type: 'damageZone', damagePerSecond: 40, oneShot: false },
    ]);
    expect(steps.every(s => s.executor === 'game_component')).toBe(true);
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  it('falls back to enemies and hazard-named props when the system names none', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-slime', 'Slime', 'enemy'),
      planned('uuid-lava', 'Lava Pool', 'decoration'),
      planned('uuid-tree', 'Tree', 'decoration'),
    ];

    const steps = run(makeSystem('obstacles', {}), makeGdd(), makeCtx(entities));

    expect(inputsOfType(steps, 'damageZone').map(z => z.entityId)).toEqual([
      'uuid-slime',
      'uuid-lava',
    ]);
  });

  it('reads an explicit one-shot instant-kill hazard from the config', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-pit', 'Bottomless Pit', 'decoration'),
    ];

    const steps = run(
      makeSystem('hazards', { hazards: ['Bottomless Pit'], damage: 500, oneShot: true }),
      makeGdd(),
      makeCtx(entities),
    );

    expect(inputsOfType(steps, 'damageZone')).toEqual([
      { entityId: 'uuid-pit', type: 'damageZone', damagePerSecond: 500, oneShot: true },
    ]);
  });

  it('plans complete bags the real executor accepts', async () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-spikes', 'Spikes', 'decoration'),
    ];
    const steps = run(makeSystem('hazards', { hazards: ['Spikes'] }), makeGdd(), makeCtx(entities));

    const components = await applySteps(steps, entities);

    expect(components).toEqual({
      'uuid-player': [
        {
          type: 'health',
          health: {
            maxHp: 100,
            currentHp: 100,
            invincibilitySecs: 0.5,
            respawnOnDeath: true,
            respawnPoint: [0, 1, 0],
            despawnOnDeath: false,
          },
        },
      ],
      'uuid-spikes': [
        {
          type: 'damageZone',
          damageZone: { damagePerSecond: 25, oneShot: false },
        },
      ],
    });
  });

  // -------------------------------------------------------------------------
  // Health hand-off with the feedback system
  // -------------------------------------------------------------------------

  it('plans the player health itself when no feedback system provides one', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-spikes', 'Spikes', 'decoration'),
    ];

    const steps = run(makeSystem('hazards', {}), makeGdd(), makeCtx(entities));

    // Health first: the thing that survives the hazard is set up before the
    // hazard that damages it.
    expect(steps[0].input).toEqual({
      entityId: 'uuid-player',
      type: 'health',
      maxHp: 100,
      currentHp: 100,
      invincibilitySecs: 0.5,
      respawnOnDeath: true,
      respawnPoint: [0, 1, 0],
      despawnOnDeath: false,
    });
  });

  it('does NOT plan player health when a health-shaped feedback system already does', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-spikes', 'Spikes', 'decoration'),
    ];
    const ctx = makeCtx(entities);

    const steps = run(makeSystem('hazards', {}), gddWithHealthFeedback(), ctx);

    expect(inputsOfType(steps, 'health')).toEqual([]);
    expect(inputsOfType(steps, 'damageZone')).toHaveLength(1);
  });

  it('treats a feedback system carrying hp config as health-shaped', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-spikes', 'Spikes', 'decoration'),
    ];

    const gdd = makeGdd([
      { category: 'feedback', type: 'juice', config: { maxHp: 3 }, priority: 'core', dependsOn: [] },
    ]);
    const steps = run(makeSystem('hazards', {}), gdd, makeCtx(entities));

    expect(inputsOfType(steps, 'health')).toEqual([]);
  });

  it('plans player health when the feedback system is not health-shaped', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-spikes', 'Spikes', 'decoration'),
    ];

    const gdd = makeGdd([
      { category: 'feedback', type: 'screen_shake', config: {}, priority: 'core', dependsOn: [] },
    ]);
    const steps = run(makeSystem('hazards', {}), gdd, makeCtx(entities));

    expect(inputsOfType(steps, 'health')).toHaveLength(1);
  });

  it('reads the player max hp from the config', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-spikes', 'Spikes', 'decoration'),
    ];

    const steps = run(makeSystem('hazards', { maxHealth: 3 }), makeGdd(), makeCtx(entities));

    expect(inputsOfType(steps, 'health')[0]).toMatchObject({ maxHp: 3, currentHp: 3 });
  });

  it('plans no health when the design named no player', () => {
    const entities = [planned('uuid-spikes', 'Spikes', 'decoration')];

    const steps = run(makeSystem('hazards', { hazards: ['Spikes'] }), makeGdd(), makeCtx(entities));

    expect(inputsOfType(steps, 'health')).toEqual([]);
    expect(inputsOfType(steps, 'damageZone')).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Drop-and-warn
  // -------------------------------------------------------------------------

  it('DROPS a named hazard that resolves to nothing and warns instead', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-spikes', 'Spikes', 'decoration'),
    ];
    const ctx = makeCtx(entities);

    const steps = run(
      makeSystem('hazards', { hazards: ['Spikes', 'Molten Core'] }),
      makeGdd(),
      ctx,
    );

    expect(inputsOfType(steps, 'damageZone').map(z => z.entityId)).toEqual(['uuid-spikes']);
    expect(steps.some(s => JSON.stringify(s.input).includes('Molten'))).toBe(false);
    expect(ctx.warn).toHaveBeenCalledTimes(1);
    expect(ctx.warn.mock.calls[0][0]).toContain('Molten Core');
  });

  it('DROPS the player when the design names it as a hazard', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-spikes', 'Spikes', 'decoration'),
    ];
    const ctx = makeCtx(entities);

    const steps = run(makeSystem('hazards', { hazards: ['Hero', 'Spikes'] }), makeGdd(), ctx);

    expect(inputsOfType(steps, 'damageZone').map(z => z.entityId)).toEqual(['uuid-spikes']);
    expect(ctx.warn).toHaveBeenCalledTimes(1);
    expect(ctx.warn.mock.calls[0][0]).toContain('Hero');
  });

  it('warns and plans nothing when every named hazard is unresolvable', () => {
    const ctx = makeCtx([planned('uuid-player', 'Hero', 'player')]);

    const steps = run(makeSystem('hazards', { hazards: ['Ghost Spikes'] }), makeGdd(), ctx);

    expect(steps).toEqual([]);
    expect(ctx.warn).toHaveBeenCalled();
  });

  it('warns and plans nothing when the world holds no entities at all', () => {
    const ctx = makeCtx([]);

    const steps = run(makeSystem('hazards', {}), makeGdd(), ctx);

    expect(steps).toEqual([]);
    expect(ctx.warn).toHaveBeenCalled();
  });

  it('warns and plans nothing when nothing in the world is a hazard', () => {
    const ctx = makeCtx([
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-tree', 'Tree', 'decoration'),
    ]);

    const steps = run(makeSystem('obstacles', {}), makeGdd(), ctx);

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
  ])('ignores a config damage that is %s and uses the default', (_label, damage) => {
    const entities = [planned('uuid-spikes', 'Spikes', 'decoration')];

    const steps = run(makeSystem('hazards', { damage }), makeGdd(), makeCtx(entities));

    expect(inputsOfType(steps, 'damageZone')[0].damagePerSecond).toBe(25);
  });

  it('ignores a non-boolean oneShot', () => {
    const entities = [planned('uuid-spikes', 'Spikes', 'decoration')];

    const steps = run(
      makeSystem('hazards', { oneShot: 'yes please' }),
      makeGdd(),
      makeCtx(entities),
    );

    expect(inputsOfType(steps, 'damageZone')[0].oneShot).toBe(false);
  });

  it('reads the config with Object.hasOwn, not a bare index', () => {
    const entities = [planned('uuid-spikes', 'Spikes', 'decoration')];
    const config = Object.create({ damage: 999, oneShot: true }) as Record<string, unknown>;

    const steps = run(makeSystem('hazards', config), makeGdd(), makeCtx(entities));

    expect(inputsOfType(steps, 'damageZone')[0]).toEqual({
      entityId: 'uuid-spikes',
      type: 'damageZone',
      damagePerSecond: 25,
      oneShot: false,
    });
  });

  it('plans one damage zone per entity even when a name is repeated', () => {
    const entities = [planned('uuid-spikes', 'Spikes', 'decoration')];

    const steps = run(
      makeSystem('hazards', { hazards: ['Spikes', 'spikes'] }),
      makeGdd(),
      makeCtx(entities),
    );

    expect(inputsOfType(steps, 'damageZone')).toHaveLength(1);
  });
});
