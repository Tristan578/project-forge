import { describe, it, expect } from 'vitest';
import { SYSTEM_REGISTRY, registerSystem } from '../index';
import type { GameSystem, OrchestratorGDD } from '../../types';

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

    const steps = def.setupSteps(system, gdd);

    expect(steps).toHaveLength(2);
    expect(steps[0].executor).toBe('physics_profile');
    expect(steps[0].input).toEqual({ config: { speed: 5 }, systemType: 'topdown' });
    expect(steps[1].executor).toBe('character_setup');
    expect(steps[1].input).toEqual({ movementType: 'topdown', systemConfig: { speed: 5 } });
  });
});

describe('camera system', () => {
  it('produces scene_create step with camera config', () => {
    const def = SYSTEM_REGISTRY.get('camera')!;
    const system = makeSystem({ category: 'camera', type: 'follow', config: { smoothing: 0.8 } });
    const gdd = makeGDD();

    const steps = def.setupSteps(system, gdd);

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

    const steps = def.setupSteps(system, gdd);

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
    const steps = def.setupSteps(makeSystem(), makeGDD());
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
    const steps = def.setupSteps(makeSystem(), makeGDD());
    expect(steps[0].executor).toBe('auto_polish');

    SYSTEM_REGISTRY.delete(testCategory);
  });
});
