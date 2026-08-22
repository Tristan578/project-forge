/**
 * PF-1213 — a generated game must be able to COLLIDE.
 *
 * Rapier attaches a collider only to an entity that carries `PhysicsEnabled`
 * (`manage_physics_lifecycle`, engine/src/core/physics.rs), and that marker is
 * inserted by exactly one command: `toggle_physics` with `enabled: true`. Before
 * this ticket the pipeline never dispatched it. Every generated game therefore
 * spawned a player, a floor and a set of collectibles that could not touch each
 * other: `runtime.active_collisions` stayed empty for the whole session, so
 * `system_collectible` never fired, score never moved, and `game_win` was
 * unreachable no matter how the game was played.
 *
 * WHY THIS IS ASSERTED AT THE DISPATCHED-COMMAND LEVEL, IN NODE.
 *
 * `dispatchCommand` returns `void`. A payload the engine cannot deserialize is
 * dropped before it is queued and NOTHING reports it — not an exception, not a
 * log, not a failed test (see `.claude/rules/gotchas.md` -> Engine & Game Loop).
 * The engine itself is wasm32-only and cannot be linked from a node test, so the
 * only place the contract can be pinned here is the wire: the exact command name
 * and the exact, FULL payload object. `toEqual`, never `objectContaining` — the
 * latter is blind to the invented sibling keys that are the actual failure mode.
 *
 * The payload shapes below were verified textually against the Rust structs:
 *   - `TogglePhysicsPayload` / `UpdatePhysicsPayload` — engine/src/core/commands/physics.rs
 *   - `PhysicsData` / `PhysicsPatch` / `ColliderShape` / `RigidBodyKind`
 *     — engine/src/core/physics.rs (camelCase fields, snake_case enum values)
 *
 * Everything under test is the REAL thing: the real `buildPlan`, the real system
 * registry, the real `EXECUTOR_REGISTRY`, the real editor store. Only the WASM
 * bridge is faked (it records commands and plays back the one scene-graph round
 * trip later steps depend on) and `fetchAI` is stubbed to prove the run needs no
 * network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/ai/client', () => ({
  fetchAI: vi.fn(async () => 'forge.on("update", () => {});'),
}));

import { fetchAI } from '@/lib/ai/client';
import { buildPlan } from '../planBuilder';
import { runPipeline } from '../pipelineRunner';
import { EXECUTOR_REGISTRY } from '../executors';
import type { ExecutorContext, OrchestratorGDD, OrchestratorPlan } from '../types';
import { setWinnabilityStateReader } from '@/stores/slices';
import { createTestHarness } from '@/__integration__/harness';
import type { TestHarness } from '@/__integration__/harness';
import type { SceneNode } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Fake engine
// ---------------------------------------------------------------------------

interface Recorded {
  command: string;
  payload: unknown;
}

function attachFakeEngine(harness: TestHarness): Recorded[] {
  const recorded: Recorded[] = [];

  harness.dispatch.mockImplementation((command: string, payload: unknown) => {
    recorded.push({ command, payload });
    if (command !== 'spawn_entity') return;

    const bag = (payload ?? {}) as Record<string, unknown>;
    const rawId = Object.hasOwn(bag, 'id') ? bag['id'] : undefined;
    const rawName = Object.hasOwn(bag, 'name') ? bag['name'] : undefined;

    const entityId =
      typeof rawId === 'string' && rawId.trim().length > 0
        ? rawId
        : `engine-assigned-${recorded.length}`;
    const name = typeof rawName === 'string' && rawName.length > 0 ? rawName : 'Entity';

    const node: SceneNode = {
      entityId,
      name,
      parentId: null,
      children: [],
      components: [],
      visible: true,
    };
    harness.getState().addNode(node);
  });

  return recorded;
}

function makeContext(harness: TestHarness, projectType: '2d' | '3d'): ExecutorContext {
  return {
    dispatchCommand: harness.dispatch as unknown as ExecutorContext['dispatchCommand'],
    getStore: () => harness.getState(),
    projectType,
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: () => undefined,
  };
}

// ---------------------------------------------------------------------------
// GDD fixture
// ---------------------------------------------------------------------------

const FEEL = {
  mood: 'bright and curious',
  pacing: 'medium' as const,
  weight: 'medium' as const,
  referenceGames: ['Super Mario 64'],
  oneLiner: 'Bouncy exploration with a goal you can see from the start.',
};

/** Collect-N-items platformer in 3D — the golden-path shape. */
function crystalRun3d(): OrchestratorGDD {
  return {
    id: 'gdd-crystal-run',
    title: 'Crystal Run',
    description: 'Bounce around a small arena and gather every crystal.',
    projectType: '3d',
    estimatedScope: 'small',
    styleDirective: 'low-poly pastel',
    feelDirective: FEEL,
    constraints: [],
    systems: [
      { category: 'movement', type: 'platformer', config: {}, priority: 'core', dependsOn: [] },
      {
        category: 'world',
        type: 'platformer arena',
        config: { width: 40, depth: 40, platforms: 4, bounds: true },
        priority: 'core',
        dependsOn: [],
      },
      {
        category: 'camera',
        type: 'thirdPersonFollow',
        config: {},
        priority: 'core',
        dependsOn: ['movement'],
      },
      {
        category: 'progression',
        type: 'collect-all',
        config: { collectibleValue: 25 },
        priority: 'core',
        dependsOn: ['movement'],
      },
    ],
    scenes: [
      {
        name: 'Crystal Arena',
        purpose: 'The only level.',
        systems: ['movement', 'world', 'camera', 'progression'],
        entities: [
          { name: 'Player', role: 'player', systems: ['movement'], appearance: 'primitive:capsule' },
          { name: 'Crystal Alpha', role: 'interactable', systems: [], appearance: 'primitive:sphere' },
          { name: 'Crystal Beta', role: 'interactable', systems: [], appearance: 'primitive:sphere' },
          { name: 'Main Camera', role: 'decoration', systems: ['camera'], appearance: 'primitive:cube' },
          { name: 'Sun Light', role: 'decoration', systems: [], appearance: 'primitive:cube' },
        ],
        transitions: [],
      },
    ],
    assetManifest: [],
  };
}

// ---------------------------------------------------------------------------
// Assertion helpers — all indexed loops. A callback form skips an array hole
// outright, which would make a "nothing was dispatched" assertion pass for the
// wrong reason.
// ---------------------------------------------------------------------------

function payloadOf(entry: Recorded): Record<string, unknown> {
  return (entry.payload ?? {}) as Record<string, unknown>;
}

function spawnedIdByName(recorded: Recorded[], name: string): string | undefined {
  for (let i = 0; i < recorded.length; i += 1) {
    const entry = recorded[i];
    if (entry.command !== 'spawn_entity') continue;
    const bag = payloadOf(entry);
    if (bag['name'] !== name) continue;
    const id = bag['id'];
    if (typeof id === 'string') return id;
  }
  return undefined;
}

function spawnedNames(recorded: Recorded[]): string[] {
  const names: string[] = [];
  for (let i = 0; i < recorded.length; i += 1) {
    const entry = recorded[i];
    if (entry.command !== 'spawn_entity') continue;
    const bag = payloadOf(entry);
    const name = bag['name'];
    if (typeof name === 'string') names.push(name);
  }
  return names;
}

/** Index of the first `command` whose payload names `entityId`, or -1. */
function indexOfCommandFor(recorded: Recorded[], command: string, entityId: string): number {
  for (let i = 0; i < recorded.length; i += 1) {
    const entry = recorded[i];
    if (entry.command !== command) continue;
    if (payloadOf(entry)['entityId'] === entityId) return i;
  }
  return -1;
}

function payloadsOfCommandFor(
  recorded: Recorded[],
  command: string,
  entityId: string,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < recorded.length; i += 1) {
    const entry = recorded[i];
    if (entry.command !== command) continue;
    const bag = payloadOf(entry);
    if (bag['entityId'] === entityId) out.push(bag);
  }
  return out;
}

function firstStepIndex(plan: OrchestratorPlan, executor: string): number {
  for (let i = 0; i < plan.steps.length; i += 1) {
    if (plan.steps[i].executor === executor) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('pipeline enables physics on every gameplay entity (PF-1213)', () => {
  let harness: TestHarness;
  let recorded: Recorded[];

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetchAI).mockClear();
    harness = createTestHarness();
    recorded = attachFakeEngine(harness);
    setWinnabilityStateReader(() => {
      const state = harness.getState();
      return { sceneGraph: state.sceneGraph, allGameComponents: state.allGameComponents };
    });
  });

  afterEach(() => {
    setWinnabilityStateReader(null);
    harness.cleanup();
  });

  async function build(gdd: OrchestratorGDD): Promise<OrchestratorPlan> {
    const plan = buildPlan(gdd, 'project-under-test', 'creator', 1_000_000);
    return runPipeline(plan, EXECUTOR_REGISTRY, makeContext(harness, gdd.projectType));
  }

  it('plans a physics_enable step and completes the run', async () => {
    const plan = await build(crystalRun3d());

    expect(plan.status).toBe('completed');
    expect(plan.steps.filter(s => s.status !== 'completed')).toEqual([]);
    expect(plan.steps.filter(s => s.executor === 'physics_enable').length).toBeGreaterThan(0);
  });

  it('runs physics enablement BEFORE the win-condition wiring, verification and Play', async () => {
    const plan = await build(crystalRun3d());

    const physicsIdx = firstStepIndex(plan, 'physics_enable');
    expect(physicsIdx).toBeGreaterThanOrEqual(0);

    // `runPipeline` executes steps in ARRAY ORDER, so position in `plan.steps`
    // is the ordering guarantee. Physics has to be on before anything asks
    // whether the game can be won: `validateWinnability` runs off the store the
    // verify step inspects, and Play follows it.
    for (const later of ['physics_profile', 'game_component', 'verify_all_scenes', 'auto_polish']) {
      const idx = firstStepIndex(plan, later);
      if (idx < 0) continue;
      expect(idx).toBeGreaterThan(physicsIdx);
    }
  });

  it('enables physics on the player, the collectibles and the world geometry', async () => {
    await build(crystalRun3d());

    const names = spawnedNames(recorded);
    expect(names).toEqual(
      expect.arrayContaining(['Player', 'Crystal Alpha', 'Crystal Beta', 'Ground']),
    );

    // Every gameplay entity that was spawned must carry a matching toggle. The
    // world geometry names are discovered from what was actually spawned rather
    // than hardcoded, so a change in the geometry builder cannot quietly shrink
    // the set this test covers.
    const gameplayNames: string[] = ['Player', 'Crystal Alpha', 'Crystal Beta'];
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      if (name === 'Ground' || name.startsWith('Platform ') || name.startsWith('Wall ')) {
        gameplayNames.push(name);
      }
    }
    expect(gameplayNames.length).toBeGreaterThan(4);

    for (let i = 0; i < gameplayNames.length; i += 1) {
      const name = gameplayNames[i];
      const id = spawnedIdByName(recorded, name);
      expect(id, `${name} was spawned without a planned id`).toBeTruthy();

      const toggles = payloadsOfCommandFor(recorded, 'toggle_physics', id!);
      // FULL payload, not objectContaining: `TogglePhysicsPayload` is exactly
      // `{ entityId, enabled }` and an extra key is how a payload silently
      // stops deserializing.
      expect(toggles, `no toggle_physics for ${name}`).toEqual([
        { entityId: id, enabled: true },
      ]);
    }
  });

  it('does not give cameras and lights a collider', async () => {
    await build(crystalRun3d());

    for (const name of ['Main Camera', 'Sun Light']) {
      const id = spawnedIdByName(recorded, name);
      expect(id).toBeTruthy();
      expect(payloadsOfCommandFor(recorded, 'toggle_physics', id!)).toEqual([]);
    }
  });

  it('gives the player a rotation-locked dynamic capsule body', async () => {
    await build(crystalRun3d());

    const id = spawnedIdByName(recorded, 'Player');
    expect(id).toBeTruthy();

    const updates = payloadsOfCommandFor(recorded, 'update_physics', id!);
    expect(updates.length).toBeGreaterThan(0);

    // The FIRST update_physics is the enablement step's body definition. Later
    // ones are the feel pass (gravity/friction/restitution), which is allowed to
    // follow but must not be the only thing that ever ran.
    expect(updates[0]).toEqual({
      entityId: id,
      bodyType: 'dynamic',
      colliderShape: 'capsule',
      lockRotationX: true,
      lockRotationY: true,
      lockRotationZ: true,
      isSensor: false,
    });
  });

  it('makes collectibles sensors so a pickup does not bounce the player', async () => {
    await build(crystalRun3d());

    for (const name of ['Crystal Alpha', 'Crystal Beta']) {
      const id = spawnedIdByName(recorded, name);
      expect(id).toBeTruthy();
      const updates = payloadsOfCommandFor(recorded, 'update_physics', id!);
      expect(updates[0]).toEqual({
        entityId: id,
        bodyType: 'fixed',
        colliderShape: 'ball',
        isSensor: true,
      });
    }
  });

  it('makes world geometry a solid static body', async () => {
    await build(crystalRun3d());

    const id = spawnedIdByName(recorded, 'Ground');
    expect(id).toBeTruthy();
    const updates = payloadsOfCommandFor(recorded, 'update_physics', id!);
    expect(updates[0]).toEqual({
      entityId: id,
      bodyType: 'fixed',
      colliderShape: 'cuboid',
      isSensor: false,
    });
  });

  it('toggles physics on before patching it, for every entity', async () => {
    await build(crystalRun3d());

    // `apply_physics_updates` merges its patch onto an EXISTING `PhysicsData`
    // and DROPS it when there is none (engine/src/bridge/physics.rs). The two
    // 3D systems are registered without a `.chain()` edge, with updates first,
    // so an update dispatched before its toggle is lost in silence.
    const names = spawnedNames(recorded);
    for (let i = 0; i < names.length; i += 1) {
      const id = spawnedIdByName(recorded, names[i]);
      if (!id) continue;
      const toggleIdx = indexOfCommandFor(recorded, 'toggle_physics', id);
      const updateIdx = indexOfCommandFor(recorded, 'update_physics', id);
      if (toggleIdx < 0 && updateIdx < 0) continue;
      expect(toggleIdx, `${names[i]}: update_physics with no toggle_physics`).toBeGreaterThanOrEqual(0);
      if (updateIdx >= 0) {
        expect(updateIdx, `${names[i]}: update_physics before toggle_physics`).toBeGreaterThan(toggleIdx);
      }
    }
  });

  it('reports the enabled entities on the step output so later steps can bind to them', async () => {
    const plan = await build(crystalRun3d());

    const step = plan.steps.find(s => s.executor === 'physics_enable');
    expect(step).toBeDefined();
    const output = (step!.output ?? {}) as Record<string, unknown>;
    const ids = output['entityIds'];
    expect(Array.isArray(ids)).toBe(true);
    expect((ids as unknown[]).length).toBeGreaterThan(0);
  });
});
