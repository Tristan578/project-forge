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
import { SYSTEM_REGISTRY, chaseTuningFor } from '../index';
import type { SystemStepContext, SystemStepInput, PlannedEntity } from '../index';
import { gameComponentExecutor } from '../../executors/gameComponentExecutor';
import type { ExecutorContext, GameSystem, OrchestratorGDD, EntityBlueprint } from '../../types';
import type { GameComponentData } from '@/stores/slices/types';
import type { Behavior } from '../../behaviorVocabulary';

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
    resolveStepOutputs: vi.fn(() => []),
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

// ---------------------------------------------------------------------------
// PF-1201 — the component kinds that used to fall through to a generated script
// ---------------------------------------------------------------------------

describe('challenge system — enemies that chase', () => {
  it('gives every enemy a follower bound to the player engine id', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-slime', 'Slime', 'enemy'),
      planned('uuid-bat', 'Bat', 'enemy'),
    ];
    const ctx = makeCtx(entities);

    const steps = run(makeSystem('enemies', {}), makeGdd(), ctx);

    expect(inputsOfType(steps, 'follower')).toEqual([
      {
        entityId: 'uuid-slime',
        type: 'follower',
        targetEntityId: 'uuid-player',
        speed: 3,
        stopDistance: 1.5,
        lookAtTarget: true,
      },
      {
        entityId: 'uuid-bat',
        type: 'follower',
        targetEntityId: 'uuid-player',
        speed: 3,
        stopDistance: 1.5,
        lookAtTarget: true,
      },
    ]);
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  it('reads an authored chase speed and stop distance', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-slime', 'Slime', 'enemy'),
    ];

    const steps = run(
      makeSystem('enemies', { chaseSpeed: 7.5, attackRange: 2 }),
      makeGdd(),
      makeCtx(entities),
    );

    expect(inputsOfType(steps, 'follower')[0]).toMatchObject({
      speed: 7.5,
      stopDistance: 2,
    });
  });

  it('clamps a chase speed the engine would clamp anyway', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-slime', 'Slime', 'enemy'),
    ];

    const steps = run(
      makeSystem('enemies', { chaseSpeed: 1e9, stopDistance: 1e9 }),
      makeGdd(),
      makeCtx(entities),
    );

    expect(inputsOfType(steps, 'follower')[0]).toMatchObject({
      speed: 1000,
      stopDistance: 1000,
    });
  });

  it('plans no follower when the design explicitly turns chasing off', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-slime', 'Slime', 'enemy'),
    ];
    const ctx = makeCtx(entities);

    const steps = run(makeSystem('enemies', { chasePlayer: false }), makeGdd(), ctx);

    expect(inputsOfType(steps, 'follower')).toEqual([]);
    // The enemy is still dangerous to touch — only the pursuit was declined.
    expect(inputsOfType(steps, 'damageZone')).toHaveLength(1);
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  it('ignores a non-boolean opt-out, because a string is not a decision', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-slime', 'Slime', 'enemy'),
    ];

    const steps = run(makeSystem('enemies', { chasePlayer: 'no' }), makeGdd(), makeCtx(entities));

    expect(inputsOfType(steps, 'follower')).toHaveLength(1);
  });

  it('warns and plans no follower when enemies exist but no player does', () => {
    const entities = [planned('uuid-slime', 'Slime', 'enemy')];
    const ctx = makeCtx(entities);

    const steps = run(makeSystem('enemies', {}), makeGdd(), ctx);

    expect(inputsOfType(steps, 'follower')).toEqual([]);
    expect(inputsOfType(steps, 'damageZone')).toHaveLength(1);
    expect(ctx.warn).toHaveBeenCalledTimes(1);
    expect(ctx.warn.mock.calls[0]?.[0]).toContain('no player');
  });

  it('plans a follower bag the real executor accepts', async () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-slime', 'Slime', 'enemy'),
    ];

    const steps = run(makeSystem('enemies', {}), makeGdd(), makeCtx(entities));
    const components = await applySteps(steps, entities);

    expect(components['uuid-slime']).toEqual([
      expect.objectContaining({ type: 'damageZone' }),
      {
        type: 'follower',
        follower: {
          targetEntityId: 'uuid-player',
          speed: 3,
          stopDistance: 1.5,
          lookAtTarget: true,
        },
      },
    ]);
  });
});

describe('challenge system — platforms that move', () => {
  it('plans nothing unless the design names a platform', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-platform', 'Platform', 'decoration'),
      planned('uuid-spikes', 'Spikes', 'decoration'),
    ];

    const steps = run(makeSystem('obstacles', {}), makeGdd(), makeCtx(entities));

    // Nothing named: a level that meant its platforms to be static must stay
    // static, so the name alone is not enough.
    expect(inputsOfType(steps, 'movingPlatform')).toEqual([]);
  });

  it('routes a named platform along X as an offset from where it spawned', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-platform', 'Platform', 'decoration'),
      planned('uuid-spikes', 'Spikes', 'decoration'),
    ];
    const ctx = makeCtx(entities);

    const steps = run(
      makeSystem('obstacles', { movingPlatforms: ['Platform'] }),
      makeGdd(),
      ctx,
    );

    expect(inputsOfType(steps, 'movingPlatform')).toEqual([
      {
        entityId: 'uuid-platform',
        type: 'movingPlatform',
        speed: 2,
        // The first waypoint is the spawn point itself: the engine adds each
        // waypoint to the spawn origin, so a world-space route would teleport
        // the platform on the first frame.
        waypoints: [
          [0, 0, 0],
          [4, 0, 0],
        ],
        pauseDuration: 0.5,
        loopMode: 'pingPong',
      },
    ]);
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  it('routes something named like an elevator along Y instead', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-lift', 'Elevator', 'decoration'),
      planned('uuid-spikes', 'Spikes', 'decoration'),
    ];

    const steps = run(
      makeSystem('obstacles', { platforms: 'Elevator', distance: 6, platformSpeed: 3, pause: 0 }),
      makeGdd(),
      makeCtx(entities),
    );

    expect(inputsOfType(steps, 'movingPlatform')[0]).toEqual({
      entityId: 'uuid-lift',
      type: 'movingPlatform',
      speed: 3,
      waypoints: [
        [0, 0, 0],
        [0, 6, 0],
      ],
      // Zero is not a positive number, so an authored 0 falls to the engine
      // default rather than being read as "never pause".
      pauseDuration: 0.5,
      loopMode: 'pingPong',
    });
  });

  it('DROPS a named platform that resolves to nothing and warns instead', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-spikes', 'Spikes', 'decoration'),
    ];
    const ctx = makeCtx(entities);

    const steps = run(
      makeSystem('obstacles', { movingPlatforms: ['Ghost Platform'] }),
      makeGdd(),
      ctx,
    );

    expect(inputsOfType(steps, 'movingPlatform')).toEqual([]);
    expect(ctx.warn).toHaveBeenCalledTimes(1);
    expect(ctx.warn.mock.calls[0]?.[0]).toContain('Ghost Platform');
  });

  it('DROPS the player when the design names it as a moving platform', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-spikes', 'Spikes', 'decoration'),
    ];
    const ctx = makeCtx(entities);

    const steps = run(makeSystem('obstacles', { platforms: ['Hero'] }), makeGdd(), ctx);

    expect(inputsOfType(steps, 'movingPlatform')).toEqual([]);
    expect(ctx.warn).toHaveBeenCalledTimes(1);
    expect(ctx.warn.mock.calls[0]?.[0]).toContain('take control away');
  });

  it('plans a moving-platform bag the real executor accepts', async () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-platform', 'Platform', 'decoration'),
      planned('uuid-spikes', 'Spikes', 'decoration'),
    ];

    const steps = run(
      makeSystem('obstacles', { movingPlatforms: ['Platform'] }),
      makeGdd(),
      makeCtx(entities),
    );
    const components = await applySteps(steps, entities);

    expect(components['uuid-platform']).toEqual([
      {
        type: 'movingPlatform',
        movingPlatform: {
          speed: 2,
          waypoints: [
            [0, 0, 0],
            [4, 0, 0],
          ],
          pauseDuration: 0.5,
          loopMode: 'pingPong',
        },
      },
    ]);
  });
});

describe('challenge system — the things that keep producing more things', () => {
  it('plans a spawner for a name the design gave it', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-nest', 'Slime Pit', 'decoration'),
      planned('uuid-spikes', 'Spikes', 'decoration'),
    ];
    const ctx = makeCtx(entities);

    const steps = run(
      makeSystem('waves', { spawners: ['Slime Pit'] }),
      makeGdd(),
      ctx,
    );

    expect(inputsOfType(steps, 'spawner')).toEqual([
      {
        entityId: 'uuid-nest',
        type: 'spawner',
        entityType: 'cube',
        intervalSecs: 3,
        maxCount: 5,
        spawnOffset: [0, 1, 0],
        onTrigger: null,
      },
    ]);
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  it('falls back to an unmistakable name when the design names none', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-nest', 'Bat Nest', 'decoration'),
      planned('uuid-rock', 'Rock', 'decoration'),
      planned('uuid-spikes', 'Spikes', 'decoration'),
    ];

    const steps = run(makeSystem('waves', {}), makeGdd(), makeCtx(entities));

    expect(inputsOfType(steps, 'spawner').map(s => s.entityId)).toEqual(['uuid-nest']);
  });

  it('reads the mesh the design asked the spawner to produce', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-nest', 'Nest', 'decoration'),
    ];

    const steps = run(
      makeSystem('waves', { spawnType: 'Sphere', spawnInterval: 1.5, maxSpawns: 12 }),
      makeGdd(),
      makeCtx(entities),
    );

    expect(inputsOfType(steps, 'spawner')[0]).toMatchObject({
      entityType: 'sphere',
      intervalSecs: 1.5,
      maxCount: 12,
    });
  });

  it('warns and falls back to a cube for a mesh the engine cannot build', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-nest', 'Nest', 'decoration'),
      // Something hazardous, so the only warning left to count is the spawner's.
      planned('uuid-spikes', 'Spikes', 'decoration'),
    ];
    const ctx = makeCtx(entities);

    const steps = run(makeSystem('waves', { spawnType: 'dragon' }), makeGdd(), ctx);

    // Passing it through would fail the executor's closed enum, which fails the
    // whole step rather than degrading it.
    expect(inputsOfType(steps, 'spawner')[0]).toMatchObject({ entityType: 'cube' });
    expect(ctx.warn).toHaveBeenCalledTimes(1);
    expect(ctx.warn.mock.calls[0]?.[0]).toContain('dragon');
  });

  it('clamps an interval the engine would reject and rounds a fractional count', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-nest', 'Nest', 'decoration'),
    ];

    const steps = run(
      makeSystem('waves', { spawnInterval: 0.001, maxSpawns: 7.6 }),
      makeGdd(),
      makeCtx(entities),
    );

    expect(inputsOfType(steps, 'spawner')[0]).toMatchObject({
      intervalSecs: 0.1,
      maxCount: 8,
    });
  });

  it('does not tell a nest to walk after the player', () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-nest', 'Nest', 'enemy'),
      planned('uuid-slime', 'Slime', 'enemy'),
    ];

    const steps = run(makeSystem('waves', {}), makeGdd(), makeCtx(entities));

    expect(inputsOfType(steps, 'spawner').map(s => s.entityId)).toEqual(['uuid-nest']);
    // The nest stays put; the enemy that is not a nest still gives chase.
    expect(inputsOfType(steps, 'follower').map(s => s.entityId)).toEqual(['uuid-slime']);
  });

  it('plans a spawner bag the real executor accepts', async () => {
    const entities = [
      planned('uuid-player', 'Hero', 'player'),
      planned('uuid-nest', 'Nest', 'decoration'),
    ];

    const steps = run(makeSystem('waves', {}), makeGdd(), makeCtx(entities));
    const components = await applySteps(steps, entities);

    expect(components['uuid-nest']).toEqual([
      {
        type: 'spawner',
        spawner: {
          entityType: 'cube',
          intervalSecs: 3,
          maxCount: 5,
          spawnOffset: [0, 1, 0],
          onTrigger: null,
        },
      },
    ]);
  });
});

/**
 * The ownership rule between this system and the per-entity behaviour pass
 * (PF-1114).
 *
 * `planFollowers` plans a `follower` for EVERY enemy by default, and
 * `planBehaviorSteps` plans one for every entity carrying `behavior: 'chase'`.
 * Both writing means one entity gets two `follower` components — the second
 * overwrites the first on the engine side, so which tuning survives depends on
 * step order, which nothing pins. The rule is that per-entity intent wins and
 * this system steps back; these cases are what stops the rule being deleted by
 * someone who reads the skip as a redundant guard.
 */
describe('challenge system yields to per-entity behaviour (PF-1114)', () => {
  const definition = SYSTEM_REGISTRY.get('challenge')!;

  function plannedWithBehavior(
    entityId: string,
    name: string,
    role: EntityBlueprint['role'],
    behavior: Behavior,
  ): PlannedEntity {
    return { entityId, scene: 'Level1', entity: { ...makeEntity(name, role), behavior } };
  }

  it('plans no follower for an enemy that carries its own behaviour', () => {
    const ctx = makeCtx([
      planned('player-1', 'Player', 'player'),
      plannedWithBehavior('bat-1', 'Bat', 'enemy', 'chase'),
    ]);
    const steps = definition.setupSteps(makeSystem('enemies'), makeGdd(), ctx);

    const followers = steps.filter(s => s.input.type === 'follower');
    expect(followers).toEqual([]);
    // The enemy is still made dangerous — only the MOTION component moved
    // owners. Dropping the damage zone too would be a silent regression.
    expect(steps.filter(s => s.input.type === 'damageZone')).toHaveLength(1);
  });

  it('still plans followers for the enemies that carry none', () => {
    const ctx = makeCtx([
      planned('player-1', 'Player', 'player'),
      plannedWithBehavior('bat-1', 'Bat', 'enemy', 'patrol'),
      planned('ghost-1', 'Ghost', 'enemy'),
    ]);
    const steps = definition.setupSteps(makeSystem('enemies'), makeGdd(), ctx);

    const followers = steps.filter(s => s.input.type === 'follower');
    expect(followers).toHaveLength(1);
    expect(followers[0].input.entityId).toBe('ghost-1');
  });

  it('honours `idle` as a decision, not as an absence', () => {
    const ctx = makeCtx([
      planned('player-1', 'Player', 'player'),
      plannedWithBehavior('statue-1', 'Statue', 'enemy', 'idle'),
    ]);
    const steps = definition.setupSteps(makeSystem('enemies'), makeGdd(), ctx);

    expect(steps.filter(s => s.input.type === 'follower')).toEqual([]);
  });

  it('leaves a named moving platform alone when it carries a behaviour', () => {
    const ctx = makeCtx([
      planned('player-1', 'Player', 'player'),
      plannedWithBehavior('lift-1', 'Lift', 'decoration', 'patrol'),
      planned('slab-1', 'Slab', 'decoration'),
    ]);
    const steps = definition.setupSteps(
      makeSystem('platforms', { movingPlatforms: ['Lift', 'Slab'] }),
      makeGdd(),
      ctx,
    );

    const platforms = steps.filter(s => s.input.type === 'movingPlatform');
    expect(platforms).toHaveLength(1);
    expect(platforms[0].input.entityId).toBe('slab-1');
  });
});

describe('chaseTuningFor', () => {
  it('reads the tuning the design asked for', () => {
    const gdd = makeGdd([makeSystem('pursuit', { chaseSpeed: 7, stopDistance: 3 })]);
    expect(chaseTuningFor(gdd)).toEqual({ speed: 7, stopDistance: 3 });
  });

  it('falls back to the engine defaults when no challenge system exists', () => {
    // `FollowerData::default()` — an unstated value must stay the engine's own,
    // not a second guess that drifts from it.
    expect(chaseTuningFor(makeGdd())).toEqual({ speed: 3, stopDistance: 1.5 });
  });

  it('clamps a runaway speed the same way the follower pass does', () => {
    const gdd = makeGdd([makeSystem('pursuit', { chaseSpeed: 10_000_000 })]);
    expect(chaseTuningFor(gdd).speed).toBe(1000);
  });
});
