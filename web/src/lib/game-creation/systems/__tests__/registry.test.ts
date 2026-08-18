import { describe, it, expect, vi } from 'vitest';
import { SYSTEM_REGISTRY, registerSystem } from '../index';
import type { SystemStepContext } from '../index';
import type { GameSystem, OrchestratorGDD, EntityBlueprint } from '../../types';

function makeEntity(overrides?: Partial<EntityBlueprint>): EntityBlueprint {
  return {
    name: 'Hero',
    role: 'player',
    systems: [],
    appearance: 'a knight',
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<SystemStepContext>): SystemStepContext {
  return { entities: [], warn: () => {}, ...overrides };
}

/** A ctx carrying exactly one player-role entity, which is the normal case. */
function makePlayerCtx(overrides?: Partial<SystemStepContext>): SystemStepContext {
  return makeCtx({
    entities: [{ entityId: 'id-hero', scene: 'Level1', entity: makeEntity() }],
    ...overrides,
  });
}

function makeSystem(overrides?: Partial<GameSystem>): GameSystem {
  return {
    category: 'movement',
    type: 'platformer',
    config: {},
    priority: 'core',
    dependsOn: [],
    ...overrides,
  };
}

function makeGDD(overrides?: Partial<OrchestratorGDD>): OrchestratorGDD {
  return {
    id: 'gdd_1',
    title: 'Test Game',
    description: 'A test game',
    systems: [],
    scenes: [],
    assetManifest: [],
    estimatedScope: 'small' as never,
    styleDirective: 'pixel-art',
    feelDirective: {
      mood: 'fun',
      pacing: 'medium',
      weight: 'medium',
      referenceGames: [],
      oneLiner: 'A fun game',
    },
    constraints: [],
    projectType: '3d',
    ...overrides,
  };
}

describe('SYSTEM_REGISTRY', () => {
  it('has movement system registered', () => {
    expect(SYSTEM_REGISTRY.has('movement')).toBe(true);
  });

  it('has camera system registered', () => {
    expect(SYSTEM_REGISTRY.has('camera')).toBe(true);
  });

  it('has world system registered', () => {
    expect(SYSTEM_REGISTRY.has('world')).toBe(true);
  });

  it('has entities system registered (components only — planBuilder still spawns)', () => {
    expect(SYSTEM_REGISTRY.has('entities')).toBe(true);
  });

  it('has challenge system registered', () => {
    expect(SYSTEM_REGISTRY.has('challenge')).toBe(true);
  });
});

describe('movement system', () => {
  it('produces physics_profile and character_setup steps', () => {
    const def = SYSTEM_REGISTRY.get('movement')!;
    const system = makeSystem({ type: 'topdown', config: { speed: 5 } });
    const gdd = makeGDD();

    const steps = def.setupSteps(system, gdd, makePlayerCtx());

    expect(steps).toHaveLength(2);
    expect(steps[0].executor).toBe('physics_profile');
    expect(steps[0].input).toEqual({ config: { speed: 5 }, systemType: 'topdown' });
    expect(steps[1].executor).toBe('character_setup');
    expect(steps[1].input).toEqual({
      movementType: 'topdown',
      systemConfig: { speed: 5 },
      entityId: 'id-hero',
      entity: makeEntity(),
    });
  });

  // The engine matches `add_game_component`/`create_skeleton2d` on the EntityId
  // component. `character_setup` never carried one, so the executor fell back to
  // the designed NAME — which matches no entity, and the engine's match loops
  // emit nothing on a miss. The plan mints the id, so the registry must forward it.
  it('binds character_setup to the planned player entity id', () => {
    const def = SYSTEM_REGISTRY.get('movement')!;
    const player = makeEntity({ name: 'Knight' });
    const ctx = makeCtx({
      entities: [
        { entityId: 'id-goblin', scene: 'Level1', entity: makeEntity({ name: 'Goblin', role: 'enemy' }) },
        { entityId: 'id-knight', scene: 'Level1', entity: player },
      ],
    });

    const steps = def.setupSteps(makeSystem(), makeGDD(), ctx);

    expect(steps[1].executor).toBe('character_setup');
    expect(steps[1].input.entityId).toBe('id-knight');
    // The GDD's own player, not the executor's hardcoded 'Player' default —
    // a store lookup keyed on the wrong name is how this silently missed before.
    expect(steps[1].input.entity).toEqual(player);
  });

  // A GDD is LLM-authored, so a movement system with no player-role entity is
  // reachable. There is nothing for `character_setup` to target, so the step is
  // not planned at all — planning it would hard-fail a non-optional step and
  // abandon the whole build over one unbuildable rig, throwing away the level,
  // the collectibles and the win condition along with it.
  it('omits the character_setup step when the GDD declares no player entity', () => {
    const def = SYSTEM_REGISTRY.get('movement')!;
    const warn = vi.fn();
    const ctx = makeCtx({
      warn,
      entities: [
        { entityId: 'id-goblin', scene: 'Level1', entity: makeEntity({ name: 'Goblin', role: 'enemy' }) },
      ],
    });

    const steps = def.setupSteps(makeSystem(), makeGDD(), ctx);

    expect(steps).toHaveLength(1);
    expect(steps[0].executor).toBe('physics_profile');
    expect(steps.some(s => s.executor === 'character_setup')).toBe(false);
  });

  // Dropping the step silently would trade a hard failure for an inexplicable
  // one: the player just cannot move and nothing says why.
  it('warns when it drops the character step for want of a player', () => {
    const def = SYSTEM_REGISTRY.get('movement')!;
    const warn = vi.fn();

    def.setupSteps(makeSystem(), makeGDD(), makeCtx({ warn }));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/movement/i);
  });

  it('does not warn when a player entity is present', () => {
    const def = SYSTEM_REGISTRY.get('movement')!;
    const warn = vi.fn();

    def.setupSteps(makeSystem(), makeGDD(), makePlayerCtx({ warn }));

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('camera system', () => {
  // Repointed from `scene_create` in PF-1125: scene creation runs before any
  // entity is spawned, so it had no camera entity to configure and the directive
  // was dropped for every generated game.
  it('produces camera_setup step with camera config', () => {
    const def = SYSTEM_REGISTRY.get('camera')!;
    const system = makeSystem({ category: 'camera', type: 'follow', config: { smoothing: 0.8 } });
    const gdd = makeGDD();

    const steps = def.setupSteps(system, gdd, makePlayerCtx());

    expect(steps).toHaveLength(1);
    expect(steps[0].executor).toBe('camera_setup');
    // Full-shape `toEqual`: the follow target is the whole reason this step is
    // not a no-op, and a partial matcher is blind to its absence.
    expect(steps[0].input).toEqual({
      cameraMode: 'follow',
      cameraConfig: { smoothing: 0.8 },
      targetEntityId: 'id-hero',
    });
  });

  // Every mode but `fixed` is inert without a target — the engine skips the
  // whole update arm — so a player-less follow camera has to say so at plan
  // time rather than ship as a motionless camera that reported success.
  it('warns and omits the target when the GDD names no player', () => {
    const def = SYSTEM_REGISTRY.get('camera')!;
    const warn = vi.fn();

    const steps = def.setupSteps(
      makeSystem({ category: 'camera', type: 'third-person', config: {} }),
      makeGDD(),
      makeCtx({ warn }),
    );

    expect(steps[0].input).toEqual({ cameraMode: 'third-person', cameraConfig: {} });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/player/i);
  });

  it('does not warn for a fixed camera, the one mode that needs no target', () => {
    const def = SYSTEM_REGISTRY.get('camera')!;
    const warn = vi.fn();

    def.setupSteps(
      makeSystem({ category: 'camera', type: 'fixed', config: {} }),
      makeGDD(),
      makeCtx({ warn }),
    );

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('world system', () => {
  /**
   * PF-1138 — this used to plan a `scene_create` step carrying `worldConfig`,
   * which that executor accepted and then dropped, so every generated game was
   * an empty room. The world is now built as real entities.
   */
  it('plans a world_build step carrying spawn descriptors, not a config blob', () => {
    const def = SYSTEM_REGISTRY.get('world')!;
    const system = makeSystem({
      category: 'world',
      type: 'flat',
      config: { width: 30, depth: 20 },
    });

    const steps = def.setupSteps(system, makeGDD(), makeCtx());

    expect(steps).toHaveLength(1);
    expect(steps[0].executor).toBe('world_build');

    const input = steps[0].input as {
      worldType: string;
      entities: Array<Record<string, unknown>>;
    };
    expect(input.worldType).toBe('flat');
    // No `worldConfig` key at all: an accepted-but-unused field is the exact
    // shape of the silent drop this step exists to close.
    expect(Object.keys(input).sort()).toEqual(['entities', 'worldType']);
    expect(input.entities).toHaveLength(1);
    expect(input.entities[0]).toEqual({
      entityId: expect.any(String),
      name: 'Ground',
      entityType: 'cube',
      position: [0, -0.5, 0],
      scale: [30, 1, 20],
    });
  });

  it('binds every descriptor to a distinct engine UUID', () => {
    const def = SYSTEM_REGISTRY.get('world')!;
    const system = makeSystem({
      category: 'world',
      type: 'platformer',
      config: { width: 40, platformCount: 3, bounds: true },
    });

    const steps = def.setupSteps(system, makeGDD(), makeCtx());
    const entities = (steps[0].input as { entities: Array<{ entityId: string }> }).entities;

    const ids = new Set<string>();
    for (let i = 0; i < entities.length; i += 1) {
      expect(entities[i].entityId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      ids.add(entities[i].entityId);
    }
    expect(ids.size).toBe(entities.length);
    expect(entities.length).toBeGreaterThan(1);
  });

  it('forwards a dropped piece of config to the user rather than swallowing it', () => {
    const def = SYSTEM_REGISTRY.get('world')!;
    const warn = vi.fn();
    const system = makeSystem({
      category: 'world',
      type: 'procedural',
      config: { biome: 'forest' },
    });

    def.setupSteps(system, makeGDD(), makeCtx({ warn }));

    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.map((c) => String(c[0])).join(' ')).toMatch(/biome/);
  });

  it('builds 2D worlds in the plane the side view can actually show', () => {
    const def = SYSTEM_REGISTRY.get('world')!;
    const system = makeSystem({ category: 'world', type: 'flat', config: { width: 40 } });

    const steps = def.setupSteps(system, makeGDD({ projectType: '2d' }), makeCtx());
    const entities = (steps[0].input as { entities: Array<{ scale: number[] }> }).entities;

    expect(entities[0].scale).toEqual([40, 1, 1]);
  });
});

describe('registerSystem', () => {
  it('adds a new system to the registry', () => {
    const testCategory = `_test_${Date.now()}`;

    registerSystem({
      category: testCategory,
      setupSteps: () => [{ executor: 'verify_all_scenes', input: {} }],
    });

    expect(SYSTEM_REGISTRY.has(testCategory)).toBe(true);
    const def = SYSTEM_REGISTRY.get(testCategory)!;
    const steps = def.setupSteps(makeSystem(), makeGDD(), makeCtx());
    expect(steps[0].executor).toBe('verify_all_scenes');

    // Clean up
    SYSTEM_REGISTRY.delete(testCategory);
  });

  it('overwrites existing system definition', () => {
    const testCategory = `_test_overwrite_${Date.now()}`;

    registerSystem({
      category: testCategory,
      setupSteps: () => [{ executor: 'plan_present', input: {} }],
    });

    registerSystem({
      category: testCategory,
      setupSteps: () => [{ executor: 'auto_polish', input: {} }],
    });

    const def = SYSTEM_REGISTRY.get(testCategory)!;
    const steps = def.setupSteps(makeSystem(), makeGDD(), makeCtx());
    expect(steps[0].executor).toBe('auto_polish');

    SYSTEM_REGISTRY.delete(testCategory);
  });
});
