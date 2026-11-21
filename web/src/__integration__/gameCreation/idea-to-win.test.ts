/**
 * End-to-end integration: a game design document becomes a game that can
 * actually be PLAYED.
 *
 * Everything between the GDD and the store is real here — the real
 * `buildPlan`, the real system registry (importing `planBuilder` registers all
 * seven categories), the real `EXECUTOR_REGISTRY`, the real `runPipeline`, the
 * real Zustand slices, and the real `validateWinnability`. The ONLY fake is the
 * outermost edge: the WASM `dispatchCommand`, which is a recorder that also
 * mirrors `spawn_entity` back into the scene graph the way the engine's
 * SCENE_GRAPH event would. Nothing in the pipeline is stubbed, because the
 * pipeline is the thing under test.
 *
 * There is no network fake because there is no network edge: every GDD below
 * uses registered system categories, so `custom_script_generate` — the one
 * executor that calls out — is never planned, and `asset_generate` is local.
 *
 * Why this shape of test exists at all: `dispatchCommand` returns `void`, so a
 * command the engine would reject, drop, or silently mangle produces no signal
 * anywhere. A unit test of any single executor cannot see the game not being
 * playable. Only running the whole plan and then asking the real winnability
 * gate can.
 *
 * The negative case is load-bearing. `createTestHarness()` does NOT wire
 * `setWinnabilityStateReader`, so a test that forgot to wire it would watch
 * `play()` dispatch unconditionally and go green while proving nothing. Every
 * test here wires the reader, and the unwinnable case proves the gate is live
 * by watching `play()` refuse.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { buildPlan } from '@/lib/game-creation/planBuilder';
import { runPipeline } from '@/lib/game-creation/pipelineRunner';
import { EXECUTOR_REGISTRY } from '@/lib/game-creation/executors';
import { collectStepWarnings } from '@/lib/game-creation/stepWarnings';
import type {
  ExecutorContext,
  OrchestratorGDD,
  OrchestratorPlan,
  PlanStep,
} from '@/lib/game-creation/types';
import { validateWinnability } from '@/lib/playMode/winnabilityValidator';
import { setWinnabilityStateReader } from '@/stores/slices';

import { createTestHarness, type TestHarness } from '../harness';

// ---------------------------------------------------------------------------
// Fixtures — realistic GDDs, in the shape the decomposer emits
// ---------------------------------------------------------------------------

const FEEL_3D = {
  mood: 'tense but hopeful',
  pacing: 'medium' as const,
  weight: 'medium' as const,
  referenceGames: ['Spelunky', 'Jak and Daxter'],
  oneLiner: 'Grounded, deliberate spelunking with a bit of bounce.',
};

const FEEL_2D = {
  mood: 'neon and urgent',
  pacing: 'fast' as const,
  weight: 'light' as const,
  referenceGames: ['Celeste'],
  oneLiner: 'Snappy, weightless sprinting toward the exit.',
};

/** 3D collect-all: gather the crystals, do not die on the way. */
const CRYSTAL_CAVERNS: OrchestratorGDD = {
  id: 'gdd_crystal_caverns',
  title: 'Crystal Caverns',
  description: 'A miner gathers glowing crystals from a collapsing cave.',
  projectType: '3d',
  estimatedScope: 'small',
  styleDirective: 'low-poly caves lit by bioluminescent crystals',
  feelDirective: FEEL_3D,
  constraints: ['single level', 'no combat'],
  systems: [
    {
      category: 'movement',
      type: 'platformer',
      config: { speed: 6, jumpHeight: 3 },
      priority: 'core',
      dependsOn: [],
    },
    {
      category: 'world',
      type: 'cave-platforms',
      config: { platformCount: 4, groundSize: 50 },
      priority: 'core',
      dependsOn: [],
    },
    {
      category: 'progression',
      type: 'collect-all-crystals',
      config: { winCondition: 'collect every crystal', collectibleValue: 25 },
      priority: 'core',
      dependsOn: ['movement'],
    },
    {
      category: 'camera',
      type: 'thirdPersonFollow',
      config: { followDistance: 8, followHeight: 4 },
      priority: 'secondary',
      dependsOn: ['movement'],
    },
    {
      category: 'feedback',
      type: 'health',
      config: { maxHealth: 80 },
      priority: 'secondary',
      dependsOn: ['movement'],
    },
  ],
  scenes: [
    {
      name: 'Cavern',
      purpose: 'The single playable cave level.',
      systems: ['movement', 'world', 'progression', 'camera', 'feedback'],
      transitions: [],
      entities: [
        { name: 'Miner', role: 'player', systems: ['movement'], appearance: 'primitive:capsule' },
        { name: 'CrystalA', role: 'interactable', systems: ['progression'], appearance: 'primitive:sphere' },
        { name: 'CrystalB', role: 'interactable', systems: ['progression'], appearance: 'primitive:sphere' },
        { name: 'MainCamera', role: 'decoration', systems: ['camera'], appearance: 'primitive:cube' },
      ],
    },
  ],
  assetManifest: [
    {
      type: 'texture',
      description: 'glowing crystal surface',
      entityRef: 'CrystalA',
      styleDirective: 'low-poly, emissive',
      priority: 'required',
      fallback: 'primitive:sphere',
    },
  ],
};

/** 2D reach-goal: run to the exit door, grab a coin on the way. */
const NEON_RUNNER: OrchestratorGDD = {
  id: 'gdd_neon_runner',
  title: 'Neon Runner',
  description: 'A courier sprints through a neon alley to the exit.',
  projectType: '2d',
  estimatedScope: 'small',
  styleDirective: 'flat neon silhouettes on black',
  feelDirective: FEEL_2D,
  constraints: ['one screen'],
  systems: [
    {
      category: 'movement',
      type: 'sideScroller',
      config: { speed: 9, jumpHeight: 4 },
      priority: 'core',
      dependsOn: [],
    },
    {
      category: 'world',
      type: 'sidescroll-platforms',
      config: { platformCount: 3 },
      priority: 'core',
      dependsOn: [],
    },
    {
      category: 'progression',
      type: 'reach-the-exit',
      config: { winCondition: 'reach the exit door' },
      priority: 'core',
      dependsOn: ['movement'],
    },
    {
      category: 'camera',
      type: 'sideScroller',
      config: { followDistance: 10 },
      priority: 'secondary',
      dependsOn: ['movement'],
    },
  ],
  scenes: [
    {
      name: 'Alley',
      purpose: 'The single side-scrolling level.',
      systems: ['movement', 'world', 'progression', 'camera'],
      transitions: [],
      entities: [
        { name: 'Runner', role: 'player', systems: ['movement'], appearance: 'sprite:runner' },
        { name: 'ExitDoor', role: 'trigger', systems: ['progression'], appearance: 'sprite:door' },
        { name: 'Coin', role: 'interactable', systems: ['progression'], appearance: 'sprite:coin' },
        { name: 'LevelCamera', role: 'decoration', systems: ['camera'], appearance: 'sprite:none' },
      ],
    },
  ],
  assetManifest: [],
};

/**
 * The same 3D game with the `progression` system deleted — nothing plans a win
 * condition, so nothing can win. This is the case a green-only test would miss.
 */
const UNWINNABLE_CAVERNS: OrchestratorGDD = {
  ...CRYSTAL_CAVERNS,
  id: 'gdd_unwinnable',
  title: 'Crystal Caverns (no goal)',
  systems: CRYSTAL_CAVERNS.systems.filter(s => s.category !== 'progression'),
  scenes: [
    {
      ...CRYSTAL_CAVERNS.scenes[0],
      systems: ['movement', 'world', 'camera', 'feedback'],
    },
  ],
  assetManifest: [],
};

/**
 * A design that named its systems but placed nothing in the world.
 *
 * This is the one shape the plan-level win-condition guarantee cannot rescue: a
 * `winCondition` component has to ride on an entity, and a component bound to
 * an empty id is rejected by the engine — which would fail the plan for a
 * reason that has nothing to do with the real problem. So the builder plans no
 * condition, says so, and the game stays honestly unwinnable.
 */
const EMPTY_CAVERNS: OrchestratorGDD = {
  ...UNWINNABLE_CAVERNS,
  id: 'gdd_empty',
  title: 'Crystal Caverns (empty)',
  scenes: [{ ...UNWINNABLE_CAVERNS.scenes[0], entities: [] }],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Payload = Record<string, unknown>;

/** Every payload dispatched under `name`, in order. */
function commandsOf(h: TestHarness, name: string): Payload[] {
  const out: Payload[] = [];
  const calls = h.dispatch.mock.calls as unknown as Array<[string, unknown]>;
  for (let i = 0; i < calls.length; i += 1) {
    if (calls[i][0] !== name) continue;
    const payload = calls[i][1];
    out.push(typeof payload === 'object' && payload !== null ? (payload as Payload) : {});
  }
  return out;
}

/**
 * Every dispatched component of one kind.
 *
 * Indexed reads, never `.filter`/`.some`: a callback form skips array holes, so
 * a sparse call list would report a missing win condition as present — or an
 * unwanted one as absent, which is the direction that ships an unplayable game.
 */
function componentsOfType(payloads: Payload[], componentType: string): Payload[] {
  const out: Payload[] = [];
  for (let i = 0; i < payloads.length; i += 1) {
    const payload = payloads[i];
    if (!payload) continue;
    if (payload['componentType'] === componentType) out.push(payload);
  }
  return out;
}

function wasDispatched(h: TestHarness, name: string): boolean {
  const calls = h.dispatch.mock.calls as unknown as Array<[string, unknown]>;
  for (let i = 0; i < calls.length; i += 1) {
    if (calls[i][0] === name) return true;
  }
  return false;
}

/**
 * The UUID the plan minted for a designed entity.
 *
 * Read from the PLAN, never from the store: the plan is what every later step
 * binds to, so resolving it any other way would let a mis-bound step pass.
 */
function plannedIdOf(plan: OrchestratorPlan, entityName: string): string {
  for (const step of plan.steps) {
    if (step.executor !== 'entity_setup') continue;
    const entity = step.input.entity as { name?: unknown } | undefined;
    if (entity && entity.name === entityName) {
      const id = step.input.entityId;
      if (typeof id === 'string' && id.length > 0) return id;
    }
  }
  throw new Error(`No entity_setup step planned for "${entityName}"`);
}

function stepByExecutor(plan: OrchestratorPlan, executor: string): PlanStep {
  const step = plan.steps.find(s => s.executor === executor);
  if (!step) throw new Error(`No ${executor} step in plan`);
  return step;
}

interface RunResult {
  plan: OrchestratorPlan;
  /** Warnings surfaced by steps that only partly applied. */
  warnings: string[];
}

/**
 * The component names the engine reports on a node once physics is enabled
 * (`engine/src/core/scene_graph.rs` lists `PhysicsData` and `PhysicsEnabled`
 * in `SceneNode.components`). `verify_all_scenes` reads `PhysicsEnabled` to
 * decide whether a 3D character will actually collide, so a harness that never
 * mirrored it would report every rigged player as falling through the floor.
 */
const PHYSICS_ENABLED_COMPONENTS = ['PhysicsData', 'PhysicsEnabled'] as const;

/**
 * Drive the whole pipeline for one GDD.
 *
 * The fake dispatcher mirrors `spawn_entity` and `toggle_physics` into the
 * scene graph because that is what the engine does: `camera_setup`,
 * `auto_polish`, `verify_all_scenes` and `game_component` all read the LIVE
 * graph, and an engine that never reported back would make every one of them a
 * no-op — or, for the physics check, a false alarm on every character. The
 * mirror is deliberately honest: if the pipeline stops enabling physics on the
 * player, the stranded-character warning fires here exactly as it would in
 * the product.
 */
async function runGame(h: TestHarness, gdd: OrchestratorGDD): Promise<RunResult> {
  h.dispatch.mockImplementation((command: unknown, payload: unknown) => {
    if (typeof payload !== 'object' || payload === null) return;
    const p = payload as Payload;
    if (command === 'spawn_entity') {
      if (typeof p.id !== 'string' || typeof p.name !== 'string') return;
      h.simulateEntitySpawned({
        entityId: p.id,
        name: p.name,
        parentId: null,
        children: [],
        components: [],
        visible: true,
      });
      return;
    }
    if (command === 'toggle_physics') {
      if (typeof p.entityId !== 'string' || typeof p.enabled !== 'boolean') return;
      const node = Object.hasOwn(h.getState().sceneGraph.nodes, p.entityId) ? h.getState().sceneGraph.nodes[p.entityId] : undefined;
      if (!node) return;
      const without = node.components.filter(
        (c) => !(PHYSICS_ENABLED_COMPONENTS as readonly string[]).includes(c),
      );
      h.getState().updateNode(p.entityId, {
        components: p.enabled ? [...without, ...PHYSICS_ENABLED_COMPONENTS] : without,
      });
    }
  });

  const plan = buildPlan(gdd, 'proj_integration', 'creator', 1_000_000);
  const warnings: string[] = [];
  const ctx: ExecutorContext = {
    dispatchCommand: h.dispatch as unknown as (command: string, payload: unknown) => void,
    getStore: () => h.getState(),
    projectType: gdd.projectType,
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: () => undefined,
    resolveStepOutputs: () => [],
  };

  await runPipeline(plan, EXECUTOR_REGISTRY, ctx, {
    onStepComplete: (_stepId, result) => {
      warnings.push(...collectStepWarnings(result.output));
    },
  });

  return { plan, warnings };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('game creation: idea -> plan -> playable game', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
    // The gate `play()` consults. The harness does NOT wire this, and without
    // it `play()` dispatches unconditionally — every assertion below about the
    // gate would pass vacuously.
    setWinnabilityStateReader(() => ({
      sceneGraph: h.getState().sceneGraph,
      allGameComponents: h.getState().allGameComponents,
    }));
  });

  afterEach(() => {
    setWinnabilityStateReader(null);
    h.cleanup();
  });

  it('builds a winnable 3D collect-all game that Play accepts', async () => {
    const { plan, warnings } = await runGame(h, CRYSTAL_CAVERNS);

    expect(plan.status).toBe('completed');
    // A step that only half-applied reports it here rather than failing, so an
    // empty list is the difference between "ran" and "actually did the work".
    expect(warnings).toEqual([]);

    const playerId = plannedIdOf(plan, 'Miner');
    const cameraId = plannedIdOf(plan, 'MainCamera');
    const crystalA = plannedIdOf(plan, 'CrystalA');
    const crystalB = plannedIdOf(plan, 'CrystalB');

    // --- The player actually got spawned, under the id everything binds to ---
    // Full payload, not `objectContaining`: the payload IS the behaviour, and
    // an invented extra key is exactly what the engine drops in silence.
    const spawns = commandsOf(h, 'spawn_entity');
    expect(spawns).toContainEqual({ entityType: 'capsule', name: 'Miner', id: playerId });
    expect(spawns).toContainEqual({ entityType: 'sphere', name: 'CrystalA', id: crystalA });
    expect(spawns).toContainEqual({ entityType: 'sphere', name: 'CrystalB', id: crystalB });

    // --- World geometry exists, and every piece of it got sized ---
    // World spawns are the ones carrying a position; designed entities do not.
    const worldSpawns = spawns.filter(p => Array.isArray(p.position));
    expect(worldSpawns.length).toBeGreaterThan(0);
    expect(worldSpawns.some(p => String(p.name).toLowerCase().includes('ground'))).toBe(true);
    const resizes = commandsOf(h, 'update_transform');
    expect(resizes.map(r => r.entityId).sort()).toEqual(worldSpawns.map(s => s.id).sort());

    // --- The camera directive reached the engine, bound to the camera entity ---
    const cameraCommands = commandsOf(h, 'set_game_camera');
    expect(cameraCommands.length).toBeGreaterThan(0);
    expect(cameraCommands[0].entityId).toBe(cameraId);
    expect(commandsOf(h, 'set_active_game_camera')).toContainEqual({ entityId: cameraId });

    // --- Components: a controllable player, collectibles, a win condition ---
    const components = commandsOf(h, 'add_game_component');

    const controllers = components.filter(c => c.componentType === 'character_controller');
    expect(controllers).toHaveLength(1);
    expect(controllers[0].entityId).toBe(playerId);
    expect(Object.keys(controllers[0].properties as Payload).sort()).toEqual([
      'canDoubleJump', 'gravityScale', 'jumpHeight', 'speed',
    ]);

    expect(components).toContainEqual({
      entityId: crystalA,
      componentType: 'collectible',
      properties: { value: 25, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 90 },
    });
    expect(components).toContainEqual({
      entityId: crystalB,
      componentType: 'collectible',
      properties: { value: 25, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 90 },
    });

    expect(components).toContainEqual({
      entityId: playerId,
      componentType: 'win_condition',
      properties: { conditionType: 'collectAll', targetScore: null, targetEntityId: null },
    });

    // --- The store agrees with the wire ---
    const store = h.getState();
    expect(store.allGameComponents[playerId].map(c => c.type).sort()).toEqual([
      'characterController', 'health', 'winCondition',
    ]);

    // --- The real gate says this game can be won ---
    const report = validateWinnability(store.sceneGraph, store.allGameComponents);
    expect(report).toEqual({ winnable: true, issues: [] });

    // --- verify_all_scenes reported honestly ---
    const verify = stepByExecutor(plan, 'verify_all_scenes');
    expect(verify.status).toBe('completed');
    expect(verify.output?.winnable).toBe(true);
    expect(verify.output?.winnabilityIssues).toEqual([]);
    // The GDD names no light, so verification must SAY so rather than pass
    // everything silently — and auto_polish must then actually fix it.
    expect(verify.output?.issues).toContain('no_ambient_light');
    expect(verify.output?.passed).toBe(false);
    // The player was rigged with physics by the pipeline (mirrored into the
    // graph by the fake engine above), so the stranded-character check — a
    // 3D character with no collider falls through the floor — must be quiet.
    // This is the assertion that goes red if physics_enable stops covering
    // the player.
    expect(verify.output?.issues).not.toContain('character_without_collider');
    const playerNode = h.getState().sceneGraph.nodes[playerId];
    expect(playerNode?.components).toEqual(
      expect.arrayContaining(['PhysicsEnabled']),
    );

    const polish = stepByExecutor(plan, 'auto_polish');
    expect(polish.status).toBe('completed');
    expect(commandsOf(h, 'update_ambient_light').length).toBeGreaterThan(0);

    // --- Play is permitted ---
    h.dispatch.mockClear();
    h.getState().play();
    expect(commandsOf(h, 'play')).toEqual([{}]);
  });

  it('builds a winnable 2D reach-goal game that Play accepts', async () => {
    const { plan, warnings } = await runGame(h, NEON_RUNNER);

    expect(plan.status).toBe('completed');
    expect(warnings).toEqual([]);

    const playerId = plannedIdOf(plan, 'Runner');
    const exitId = plannedIdOf(plan, 'ExitDoor');
    const coinId = plannedIdOf(plan, 'Coin');
    const cameraId = plannedIdOf(plan, 'LevelCamera');

    // 2D entities are textured planes — an appearance override must not turn
    // one back into a 3D primitive.
    const spawns = commandsOf(h, 'spawn_entity');
    expect(spawns).toContainEqual({ entityType: 'plane', name: 'Runner', id: playerId });
    expect(spawns).toContainEqual({ entityType: 'plane', name: 'ExitDoor', id: exitId });

    const worldSpawns = spawns.filter(p => Array.isArray(p.position));
    expect(worldSpawns.length).toBeGreaterThan(0);
    const resizes = commandsOf(h, 'update_transform');
    expect(resizes.map(r => r.entityId).sort()).toEqual(worldSpawns.map(s => s.id).sort());

    // The 2D rig is a real, separate command — its absence would leave the
    // player unanimated with nothing reporting it.
    expect(commandsOf(h, 'create_skeleton2d')).toContainEqual({ entityId: playerId });

    expect(commandsOf(h, 'set_active_game_camera')).toContainEqual({ entityId: cameraId });

    const components = commandsOf(h, 'add_game_component');
    const controllers = components.filter(c => c.componentType === 'character_controller');
    expect(controllers).toHaveLength(1);
    expect(controllers[0].entityId).toBe(playerId);

    expect(components).toContainEqual({
      entityId: coinId,
      componentType: 'collectible',
      properties: { value: 10, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 90 },
    });

    // Bound to the exit's engine UUID, never its authored name — a name
    // resolves to nothing and the engine's match loop reports nothing.
    expect(components).toContainEqual({
      entityId: playerId,
      componentType: 'win_condition',
      properties: { conditionType: 'reachGoal', targetScore: null, targetEntityId: exitId },
    });

    const store = h.getState();
    // The goal the win condition points at must really be in the graph — this
    // is the exact thing `GOAL_TARGET_MISSING` exists to catch.
    expect(Object.hasOwn(store.sceneGraph.nodes, exitId)).toBe(true);

    const report = validateWinnability(store.sceneGraph, store.allGameComponents);
    expect(report).toEqual({ winnable: true, issues: [] });

    const verify = stepByExecutor(plan, 'verify_all_scenes');
    expect(verify.status).toBe('completed');
    expect(verify.output?.winnable).toBe(true);
    expect(verify.output?.winnabilityIssues).toEqual([]);

    h.dispatch.mockClear();
    h.getState().play();
    expect(commandsOf(h, 'play')).toEqual([{}]);
  });

  /**
   * The shape of nearly every generated game: a design that never said how it
   * is won. Only the `progression` system definition plans a win condition and
   * most GDDs declare none, so until the plan-level guarantee existed this
   * built a complete world that `play()` then refused to start.
   */
  it('gives a game with no progression system a winnable goal, and Play is permitted', async () => {
    const { plan } = await runGame(h, UNWINNABLE_CAVERNS);

    expect(plan.status).toBe('completed');

    const components = commandsOf(h, 'add_game_component');
    expect(componentsOfType(components, 'character_controller')).toHaveLength(1);

    // Exactly one — a substituted goal must never sit alongside a designed one,
    // which would be a second rule the player was never told about.
    const conditions = componentsOfType(components, 'win_condition');
    expect(conditions).toHaveLength(1);

    // Bound to the player by engine UUID, and satisfiable: `score` is the one
    // condition that needs no further structure, and the validator refuses a
    // target that is zero, negative or non-finite.
    expect(conditions[0]['entityId']).toBe(plannedIdOf(plan, 'Miner'));
    const props = conditions[0]['properties'] as Record<string, unknown>;
    expect(props['conditionType']).toBe('score');
    expect(Number.isFinite(props['targetScore'] as number)).toBe(true);
    expect(props['targetScore'] as number).toBeGreaterThan(0);

    const store = h.getState();
    const report = validateWinnability(store.sceneGraph, store.allGameComponents);
    expect(report).toEqual({ winnable: true, issues: [] });

    const verify = stepByExecutor(plan, 'verify_all_scenes');
    expect(verify.status).toBe('completed');
    expect(verify.output?.winnable).toBe(true);
    expect(verify.output?.winnabilityIssues).toEqual([]);

    h.dispatch.mockClear();
    h.getState().play();
    expect(commandsOf(h, 'play')).toEqual([{}]);
  });

  it('refuses to call a game with nothing in the world playable', async () => {
    const { plan } = await runGame(h, EMPTY_CAVERNS);

    // Nothing to carry a goal, so none was planned — and crucially none was
    // planned bound to an empty id, which the engine would reject.
    const components = commandsOf(h, 'add_game_component');
    expect(componentsOfType(components, 'win_condition')).toEqual([]);

    const store = h.getState();

    const report = validateWinnability(store.sceneGraph, store.allGameComponents);
    expect(report.winnable).toBe(false);
    expect(report.issues.map(i => i.code)).toEqual(['NO_WIN_CONDITION']);

    // --- verify_all_scenes reported honestly: it FAILED, and said why ---
    const verify = stepByExecutor(plan, 'verify_all_scenes');
    expect(verify.status).toBe('failed');
    expect(verify.error?.code).toBe('NOT_WINNABLE');
    expect(verify.output?.winnable).toBe(false);
    expect(verify.output?.winnabilityIssues).toEqual(['NO_WIN_CONDITION']);
    expect(String(verify.error?.message)).toContain('NO_WIN_CONDITION');

    // verify is non-optional, so its failure fails the plan and the polish step
    // never runs. A green tick here would be the pipeline lying about a game
    // nobody can play.
    expect(plan.status).toBe('failed');
    expect(stepByExecutor(plan, 'auto_polish').status).toBe('skipped');

    // --- Play REFUSES ---
    h.dispatch.mockClear();
    h.getState().play();
    expect(wasDispatched(h, 'play')).toBe(false);
  });
});
