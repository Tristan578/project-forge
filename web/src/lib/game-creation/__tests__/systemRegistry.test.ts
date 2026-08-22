/**
 * Tests for the Game Creation Orchestrator system registry.
 *
 * Verifies that each built-in system category (movement, camera, world)
 * is registered and produces the correct step shape for the plan builder.
 * Note: entities are handled by planBuilder directly, not via the system registry.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { ExecutorName, GameSystem, OrchestratorGDD } from '@/lib/game-creation/types';
import type { SystemStepContext } from '@/lib/game-creation/systems';
import { EXECUTOR_REGISTRY } from '@/lib/game-creation/executors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derived from the registry, not hand-listed. A hardcoded copy of the
 * `ExecutorName` union drifts silently in the safe-looking direction: it went
 * stale on `plan_present` and again on `camera_setup`, and a missing entry only
 * ever makes this check REJECT a name that is in fact valid. The registry is
 * also the stronger authority — a step naming an executor that type-checks but
 * was never registered dies at run time, and only this form catches that.
 */
const VALID_EXECUTOR_NAMES: ReadonlySet<ExecutorName> = new Set<ExecutorName>(
  EXECUTOR_REGISTRY.keys(),
);

/** No planned entities — these cases assert step SHAPE, not entity binding. */
function makeCtx(overrides?: Partial<SystemStepContext>): SystemStepContext {
  return { entities: [], warn: () => {}, ...overrides };
}

/**
 * A ctx carrying one player-role entity. Movement only plans its
 * `character_setup` step when the GDD designed a player to rig, so the shape
 * assertions below need one present.
 */
function makePlayerCtx(): SystemStepContext {
  return makeCtx({
    entities: [
      {
        entityId: 'id-hero',
        scene: 'Level1',
        entity: {
          name: 'Hero',
          role: 'player',
          systems: [],
          appearance: 'a knight',
        },
      },
    ],
  });
}

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

  it('has exactly 7 registered entries (movement, camera, world, progression, feedback, entities, challenge)', () => {
    // Entity SPAWNING is still planBuilder Phase 2's alone. The 'entities' and
    // 'challenge' systems plan `game_component` steps only — they never emit
    // spawn_entity — so registering them cannot duplicate Phase 2's spawns.
    //
    // Registering a category also REMOVES planBuilder's `custom_script_generate`
    // fall-through for it, so this count is a deliberate wiring pin: a category
    // added here must plan real steps or warn, never silently produce nothing.
    expect([...SYSTEM_REGISTRY.keys()]).toEqual([
      'movement',
      'camera',
      'world',
      'progression',
      'feedback',
      'entities',
      'challenge',
    ]);
  });

  it('returns undefined for an unknown category', () => {
    expect(SYSTEM_REGISTRY.get('nonexistent')).toBeUndefined();
  });

  it('each registered system has a setupSteps function returning an array', () => {
    const gdd = makeGdd();

    for (const [category, def] of SYSTEM_REGISTRY) {
      const system = makeSystem(category as GameSystem['category'], 'test_type');
      const steps = def.setupSteps(system, gdd, makeCtx());
      expect(Array.isArray(steps), `${category}.setupSteps should return an array`).toBe(true);
    }
  });

  it('all steps produced have a valid ExecutorName', () => {
    const gdd = makeGdd();

    for (const [category, def] of SYSTEM_REGISTRY) {
      const system = makeSystem(category as GameSystem['category'], 'test_type');
      const steps = def.setupSteps(system, gdd, makeCtx());
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
      const steps = def.setupSteps(system, makeGdd(), makePlayerCtx());
      expect(steps).toHaveLength(2);
    });

    it('first step uses physics_profile executor with config + systemType', () => {
      const def = SYSTEM_REGISTRY.get('movement')!;
      const system = makeSystem('movement', 'platformer');
      system.config = { gravity: 9.8 };
      const steps = def.setupSteps(system, makeGdd(), makePlayerCtx());
      expect(steps[0].executor).toBe('physics_profile');
      expect(steps[0].input).toMatchObject({
        config: system.config,
        systemType: system.type,
      });
    });

    it('second step uses character_setup executor with movementType + systemConfig', () => {
      const def = SYSTEM_REGISTRY.get('movement')!;
      const system = makeSystem('movement', 'top_down');
      system.config = { speed: 5 };
      const steps = def.setupSteps(system, makeGdd(), makePlayerCtx());
      expect(steps[1].executor).toBe('character_setup');
      expect(steps[1].input).toMatchObject({
        movementType: system.type,
        systemConfig: system.config,
        entityId: 'id-hero',
      });
    });

    // Without a player there is nothing to rig, and `character_setup` is a
    // non-optional step — planning one that cannot resolve a target fails the
    // whole plan, discarding the level, the collectibles and the win condition
    // along with the rig.
    it('drops the character step when the GDD names no player', () => {
      const def = SYSTEM_REGISTRY.get('movement')!;
      const steps = def.setupSteps(makeSystem('movement', 'top_down'), makeGdd(), makeCtx());
      expect(steps.map(s => s.executor)).toEqual(['physics_profile']);
    });
  });

  describe('camera system', () => {
    it('returns exactly 1 step', () => {
      const def = SYSTEM_REGISTRY.get('camera')!;
      const system = makeSystem('camera', 'follow');
      const steps = def.setupSteps(system, makeGdd(), makeCtx());
      expect(steps).toHaveLength(1);
    });

    // `scene_create` until PF-1125, where it could never apply: scene creation
    // precedes every spawn, so no camera entity existed to configure.
    it('uses camera_setup executor with cameraMode + cameraConfig', () => {
      const def = SYSTEM_REGISTRY.get('camera')!;
      const system = makeSystem('camera', 'orbit');
      system.config = { fov: 60 };
      const steps = def.setupSteps(system, makeGdd(), makePlayerCtx());
      expect(steps[0].executor).toBe('camera_setup');
      // Full shape, not `toMatchObject`: the follow target is what stops this
      // step being inert, and a partial matcher cannot see it go missing.
      expect(steps[0].input).toEqual({
        cameraMode: system.type,
        cameraConfig: system.config,
        targetEntityId: 'id-hero',
      });
    });
  });

  describe('world system', () => {
    it('returns the spawn step and the physics enablement that follows it', () => {
      const def = SYSTEM_REGISTRY.get('world')!;
      const system = makeSystem('world', 'open_world');
      const steps = def.setupSteps(system, makeGdd(), makeCtx());
      // Order matters and is asserted: the engine gives a collider only to an
      // entity that already carries `PhysicsEnabled`, so enablement after the
      // spawn is the whole point (PF-1213).
      expect(steps.map(s => s.executor)).toEqual(['world_build', 'physics_enable']);
    });

    it('uses world_build and never forwards the raw config (PF-1138)', () => {
      const def = SYSTEM_REGISTRY.get('world')!;
      const system = makeSystem('world', 'dungeon');
      system.config = { rooms: 10 };
      const steps = def.setupSteps(system, makeGdd(), makeCtx());

      expect(steps[0].executor).toBe('world_build');
      // Asserted on the full key set rather than `toMatchObject`: the defect
      // being closed is a field that is accepted and then dropped, and a
      // partial matcher is structurally blind to exactly that.
      expect(Object.keys(steps[0].input).sort()).toEqual(['entities', 'worldType']);
      expect((steps[0].input as { worldType: string }).worldType).toBe('dungeon');
    });
  });

  // NOTE: 'entities' system is NOT registered in the registry — entity setup
  // is handled directly by planBuilder Phase 2 to avoid duplicate spawns.
  // See systems/index.ts for rationale.
});
