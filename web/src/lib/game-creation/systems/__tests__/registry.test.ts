import { describe, it, expect } from 'vitest';
import { SYSTEM_REGISTRY, registerSystem } from '../index';
import type { SystemStepContext } from '../index';
import type { GameSystem, OrchestratorGDD, EntityBlueprint } from '../../types';

function makeEntity(overrides?: Partial<EntityBlueprint>): EntityBlueprint {
  return {
    name: 'Hero',
    role: 'player',
    systems: [],
    appearance: 'a knight',
    behaviors: ['move'],
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<SystemStepContext>): SystemStepContext {
  return { entities: [], ...overrides };
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

  it('does not have entities system registered (handled by planBuilder)', () => {
    expect(SYSTEM_REGISTRY.has('entities')).toBe(false);
  });
});

describe('movement system', () => {
  it('produces physics_profile and character_setup steps', () => {
    const def = SYSTEM_REGISTRY.get('movement')!;
    const system = makeSystem({ type: 'topdown', config: { speed: 5 } });
    const gdd = makeGDD();

    const steps = def.setupSteps(system, gdd, makeCtx());

    expect(steps).toHaveLength(2);
    expect(steps[0].executor).toBe('physics_profile');
    expect(steps[0].input).toEqual({ config: { speed: 5 }, systemType: 'topdown' });
    expect(steps[1].executor).toBe('character_setup');
    expect(steps[1].input).toEqual({ movementType: 'topdown', systemConfig: { speed: 5 } });
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

  it('omits entityId when the GDD declares no player entity', () => {
    const def = SYSTEM_REGISTRY.get('movement')!;
    const ctx = makeCtx({
      entities: [
        { entityId: 'id-goblin', scene: 'Level1', entity: makeEntity({ name: 'Goblin', role: 'enemy' }) },
      ],
    });

    const steps = def.setupSteps(makeSystem(), makeGDD(), ctx);

    expect(steps[1].input).not.toHaveProperty('entityId');
    expect(steps[1].input).not.toHaveProperty('entity');
  });
});

describe('camera system', () => {
  it('produces scene_create step with camera config', () => {
    const def = SYSTEM_REGISTRY.get('camera')!;
    const system = makeSystem({ category: 'camera', type: 'follow', config: { smoothing: 0.8 } });
    const gdd = makeGDD();

    const steps = def.setupSteps(system, gdd, makeCtx());

    expect(steps).toHaveLength(1);
    expect(steps[0].executor).toBe('scene_create');
    expect(steps[0].input).toEqual({ cameraMode: 'follow', cameraConfig: { smoothing: 0.8 } });
  });
});

describe('world system', () => {
  it('produces scene_create step with world config', () => {
    const def = SYSTEM_REGISTRY.get('world')!;
    const system = makeSystem({ category: 'world', type: 'procedural', config: { biome: 'forest' } });
    const gdd = makeGDD();

    const steps = def.setupSteps(system, gdd, makeCtx());

    expect(steps).toHaveLength(1);
    expect(steps[0].executor).toBe('scene_create');
    expect(steps[0].input).toEqual({ worldType: 'procedural', worldConfig: { biome: 'forest' } });
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
