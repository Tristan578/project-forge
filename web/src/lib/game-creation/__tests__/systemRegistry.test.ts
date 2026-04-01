/**
 * Tests for the Game Creation Orchestrator system registry.
 *
 * Verifies that each built-in system category (movement, camera, world, entities)
 * is registered and produces the correct step shape for the plan builder.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { ExecutorName, GameSystem, OrchestratorGDD } from '@/lib/game-creation/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_EXECUTOR_NAMES: ReadonlySet<ExecutorName> = new Set<ExecutorName>([
  'scene_create',
  'physics_profile',
  'character_setup',
  'entity_setup',
  'asset_generate',
  'custom_script_generate',
  'verify_all_scenes',
  'auto_polish',
]);

function makeSystem(category: GameSystem['category'], type: string): GameSystem {
  return {
    category,
    type,
    config: {},
    priority: 'core',
    dependsOn: [],
  };
}

function makeGdd(entityCountPerScene = 2, sceneCount = 1): OrchestratorGDD {
  const scenes = Array.from({ length: sceneCount }, (_, sceneIdx) => ({
    name: `scene_${sceneIdx}`,
    purpose: 'test scene',
    systems: [] as OrchestratorGDD['scenes'][number]['systems'],
    entities: Array.from({ length: entityCountPerScene }, (_, eIdx) => ({
      name: `entity_${sceneIdx}_${eIdx}`,
      role: 'decoration' as const,
      systems: [] as OrchestratorGDD['scenes'][number]['entities'][number]['systems'],
      appearance: 'cube',
      behaviors: [],
    })),
    transitions: [],
  }));

  return {
    id: 'test-gdd',
    title: 'Test Game',
    description: 'A test game',
    systems: [],
    scenes,
    assetManifest: [],
    estimatedScope: 'small',
    styleDirective: 'minimal',
    feelDirective: {
      mood: 'neutral',
      pacing: 'medium',
      weight: 'medium',
      referenceGames: [],
      oneLiner: 'test',
    },
    constraints: [],
    projectType: '3d',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SYSTEM_REGISTRY', () => {
  // Lazy import so the side-effect registrations all run before assertions.
  let SYSTEM_REGISTRY: Map<string, import('@/lib/game-creation/systems/index').SystemDefinition>;

  beforeAll(async () => {
    const mod = await import('@/lib/game-creation/systems/index');
    SYSTEM_REGISTRY = mod.SYSTEM_REGISTRY;
  });

  it('has exactly 4 registered entries (movement, camera, world, entities)', () => {
    expect(SYSTEM_REGISTRY.size).toBe(4);
    expect(SYSTEM_REGISTRY.has('movement')).toBe(true);
    expect(SYSTEM_REGISTRY.has('camera')).toBe(true);
    expect(SYSTEM_REGISTRY.has('world')).toBe(true);
    expect(SYSTEM_REGISTRY.has('entities')).toBe(true);
  });

  it('returns undefined for an unknown category', () => {
    expect(SYSTEM_REGISTRY.get('nonexistent')).toBeUndefined();
  });

  it('each registered system has a setupSteps function returning an array', () => {
    const gdd = makeGdd();

    for (const [category, def] of SYSTEM_REGISTRY) {
      const system = makeSystem(category as GameSystem['category'], 'test_type');
      const steps = def.setupSteps(system, gdd);
      expect(Array.isArray(steps), `${category}.setupSteps should return an array`).toBe(true);
    }
  });

  it('all steps produced have a valid ExecutorName', () => {
    const gdd = makeGdd();

    for (const [category, def] of SYSTEM_REGISTRY) {
      const system = makeSystem(category as GameSystem['category'], 'test_type');
      const steps = def.setupSteps(system, gdd);
      for (const step of steps) {
        expect(
          VALID_EXECUTOR_NAMES.has(step.executor),
          `${category} produced an invalid executor: "${step.executor}"`
        ).toBe(true);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Per-system step shape assertions
  // ---------------------------------------------------------------------------

  describe('movement system', () => {
    it('returns exactly 2 steps', () => {
      const def = SYSTEM_REGISTRY.get('movement')!;
      const system = makeSystem('movement', 'platformer');
      const steps = def.setupSteps(system, makeGdd());
      expect(steps).toHaveLength(2);
    });

    it('first step uses physics_profile executor with systemConfig + systemType', () => {
      const def = SYSTEM_REGISTRY.get('movement')!;
      const system = makeSystem('movement', 'platformer');
      system.config = { gravity: 9.8 };
      const steps = def.setupSteps(system, makeGdd());
      expect(steps[0].executor).toBe('physics_profile');
      expect(steps[0].input).toMatchObject({
        systemConfig: system.config,
        systemType: system.type,
      });
    });

    it('second step uses character_setup executor with movementType + systemConfig', () => {
      const def = SYSTEM_REGISTRY.get('movement')!;
      const system = makeSystem('movement', 'top_down');
      system.config = { speed: 5 };
      const steps = def.setupSteps(system, makeGdd());
      expect(steps[1].executor).toBe('character_setup');
      expect(steps[1].input).toMatchObject({
        movementType: system.type,
        systemConfig: system.config,
      });
    });
  });

  describe('camera system', () => {
    it('returns exactly 1 step', () => {
      const def = SYSTEM_REGISTRY.get('camera')!;
      const system = makeSystem('camera', 'follow');
      const steps = def.setupSteps(system, makeGdd());
      expect(steps).toHaveLength(1);
    });

    it('uses scene_create executor with cameraMode + cameraConfig', () => {
      const def = SYSTEM_REGISTRY.get('camera')!;
      const system = makeSystem('camera', 'orbit');
      system.config = { fov: 60 };
      const steps = def.setupSteps(system, makeGdd());
      expect(steps[0].executor).toBe('scene_create');
      expect(steps[0].input).toMatchObject({
        cameraMode: system.type,
        cameraConfig: system.config,
      });
    });
  });

  describe('world system', () => {
    it('returns exactly 1 step', () => {
      const def = SYSTEM_REGISTRY.get('world')!;
      const system = makeSystem('world', 'open_world');
      const steps = def.setupSteps(system, makeGdd());
      expect(steps).toHaveLength(1);
    });

    it('uses scene_create executor with worldType + worldConfig', () => {
      const def = SYSTEM_REGISTRY.get('world')!;
      const system = makeSystem('world', 'dungeon');
      system.config = { rooms: 10 };
      const steps = def.setupSteps(system, makeGdd());
      expect(steps[0].executor).toBe('scene_create');
      expect(steps[0].input).toMatchObject({
        worldType: system.type,
        worldConfig: system.config,
      });
    });
  });

  describe('entities system', () => {
    it('returns one entity_setup step per entity across all scenes', () => {
      const def = SYSTEM_REGISTRY.get('entities')!;
      const system = makeSystem('entities', 'default');
      const gdd = makeGdd(3, 2); // 3 entities × 2 scenes = 6 steps
      const steps = def.setupSteps(system, gdd);
      expect(steps).toHaveLength(6);
    });

    it('each step uses entity_setup executor', () => {
      const def = SYSTEM_REGISTRY.get('entities')!;
      const system = makeSystem('entities', 'default');
      const gdd = makeGdd(2, 1);
      const steps = def.setupSteps(system, gdd);
      for (const step of steps) {
        expect(step.executor).toBe('entity_setup');
      }
    });

    it('step input contains entity and scene name', () => {
      const def = SYSTEM_REGISTRY.get('entities')!;
      const system = makeSystem('entities', 'default');
      const gdd = makeGdd(1, 1);
      const steps = def.setupSteps(system, gdd);
      expect(steps[0].input).toMatchObject({
        entity: gdd.scenes[0].entities[0],
        scene: gdd.scenes[0].name,
      });
    });

    it('returns 0 steps when all scenes have 0 entities', () => {
      const def = SYSTEM_REGISTRY.get('entities')!;
      const system = makeSystem('entities', 'default');
      const gdd = makeGdd(0, 2);
      const steps = def.setupSteps(system, gdd);
      expect(steps).toHaveLength(0);
    });
  });
});
