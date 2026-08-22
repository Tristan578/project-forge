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
import { buildDefaultGroundDescriptor } from '../worldGeometry';
import {
  characterControllerFromProfile,
  resolvePhysicsProfile,
} from '../physicsProfileResolution';
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
  /**
   * Was the entity this command names ALREADY flushed into the store when the
   * command was dispatched? `false` for a command that names no entity, which
   * is why every assertion on this field filters by command name first.
   */
  targetVisible: boolean;
}

/**
 * The spawn flush is DEFERRED, and that is the whole point of this fake.
 *
 * `apply_spawn_requests` creates entities through Bevy's deferred `Commands`,
 * so an entity spawned in one engine frame does not exist for any other system
 * until the schedule has flushed. A fake that calls `addNode` inside the
 * dispatch call models an engine that has never existed — and it is precisely
 * the shape that let PF-1213's real defect through review: with a synchronous
 * fake, a `toggle_physics` dispatched in the same JS task as its `spawn_entity`
 * still finds the entity, so a step that toggles too early looks perfect.
 *
 * Spawns are therefore queued and drained on an animation frame - the same
 * clock `waitForEngineFrame` yields to, and one tick ahead of it, since that
 * helper nests TWO - and each recorded command carries
 * the one fact the ordering contract rests on: whether its target was visible
 * yet. `apply_physics_toggles` `drain(..)`s its queue whether or not the id
 * matched anything, so a toggle for an unflushed entity is consumed and lost
 * with nothing to show for it — `targetVisible: false` is that silent drop.
 */
function attachFakeEngine(harness: TestHarness): Recorded[] {
  const recorded: Recorded[] = [];
  const pending: SceneNode[] = [];
  let flushScheduled = false;

  const flush = () => {
    flushScheduled = false;
    // Indexed drain rather than `forEach`: a callback form skips an array hole,
    // which would leave an entity permanently unflushed and turn this fake into
    // a source of failures that say nothing about the code under test.
    for (let i = 0; i < pending.length; i += 1) {
      harness.getState().addNode(pending[i]);
    }
    pending.length = 0;
  };

  harness.dispatch.mockImplementation((command: string, payload: unknown) => {
    const bag = (payload ?? {}) as Record<string, unknown>;
    const rawTarget = Object.hasOwn(bag, 'entityId') ? bag['entityId'] : undefined;
    const targetVisible =
      typeof rawTarget === 'string'
        && Object.hasOwn(harness.getState().sceneGraph.nodes, rawTarget);

    recorded.push({ command, payload, targetVisible });
    if (command !== 'spawn_entity') return;

    const rawId = Object.hasOwn(bag, 'id') ? bag['id'] : undefined;
    const rawName = Object.hasOwn(bag, 'name') ? bag['name'] : undefined;

    const entityId =
      typeof rawId === 'string' && rawId.trim().length > 0
        ? rawId
        : `engine-assigned-${recorded.length}`;
    const name = typeof rawName === 'string' && rawName.length > 0 ? rawName : 'Entity';

    pending.push({
      entityId,
      name,
      parentId: null,
      children: [],
      components: [],
      visible: true,
    });

    if (!flushScheduled) {
      flushScheduled = true;
      // One frame, not a microtask: `runPipeline` awaits every executor, so a
      // microtask-scheduled flush would land between two steps on its own and
      // this fake would stop modelling the deferred-`Commands` gap at all.
      requestAnimationFrame(flush);
    }
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
    resolveStepOutputs: () => [],
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

/**
 * The same game with NO `world` system.
 *
 * `worldBuildExecutor` is what mints the Ground, so without that system the
 * scene reaches `verify_all_scenes` with nothing named ground/floor/plane and
 * check 5 raises `no_ground_plane` — which is the ONLY way to reach the
 * `auto_polish` repair branch end-to-end. The GDD generator produces this shape
 * routinely: `world` is a category the model may simply not emit.
 *
 * Everything else is `crystalRun3d`, so a difference between the two runs can
 * only come from the repair path.
 */
function crystalRunNoWorld3d(): OrchestratorGDD {
  const gdd = crystalRun3d();
  return {
    ...gdd,
    id: 'gdd-crystal-run-no-world',
    // Indexed rebuild rather than `.filter`: a callback form skips an array
    // hole, and a hole here would silently leave the `world` system in place and
    // make every assertion below pass for the wrong reason.
    systems: (() => {
      const kept: OrchestratorGDD['systems'] = [];
      for (let i = 0; i < gdd.systems.length; i += 1) {
        if (gdd.systems[i].category !== 'world') kept.push(gdd.systems[i]);
      }
      return kept;
    })(),
    scenes: gdd.scenes.map(scene => ({
      ...scene,
      systems: (() => {
        const kept: typeof scene.systems = [];
        for (let i = 0; i < scene.systems.length; i += 1) {
          if (scene.systems[i] !== 'world') kept.push(scene.systems[i]);
        }
        return kept;
      })(),
    })),
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

/** The subset of game-component payloads naming one engine `componentType`. */
function onlyComponentType(
  payloads: Record<string, unknown>[],
  componentType: string,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < payloads.length; i += 1) {
    if (payloads[i]?.['componentType'] === componentType) out.push(payloads[i]);
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

  it('plans the movement feel pass after EVERY physics_enable step', async () => {
    const plan = await build(crystalRun3d());

    // A plan runs `physics_enable` TWICE: planBuilder Phase 2.5 enables the
    // blueprint cast, and `systems/world.ts` enables the ground, platforms and
    // walls it mints. `physics_profile` reads `resolveStepOutputs`, which can
    // only see steps that have ALREADY produced output, so the feel pass has to
    // come after the last enablement or the geometry is invisible to it.
    //
    // Nothing about the system order guarantees that on its own: `topoSortSystems`
    // buckets by priority and both `movement` and `world` are `core`, so in this
    // very fixture movement is listed first. planBuilder therefore defers the
    // feel steps to the end of the system phase — position in `plan.steps` IS
    // the ordering, since `runPipeline` executes in array order and `dependsOn`
    // only gates.
    const enableIdxs: number[] = [];
    const profileIdxs: number[] = [];
    for (let i = 0; i < plan.steps.length; i += 1) {
      if (plan.steps[i].executor === 'physics_enable') enableIdxs.push(i);
      if (plan.steps[i].executor === 'physics_profile') profileIdxs.push(i);
    }
    // Floors: this fixture must really exercise the two-enablement shape.
    expect(enableIdxs.length).toBeGreaterThan(1);
    expect(profileIdxs.length).toBeGreaterThan(0);

    const lastEnableIdx = enableIdxs[enableIdxs.length - 1];
    for (let i = 0; i < profileIdxs.length; i += 1) {
      expect(
        profileIdxs[i],
        'a physics_profile step is planned before the last physics_enable, so the '
        + 'entities that step enables can never reach the feel pass',
      ).toBeGreaterThan(lastEnableIdx);
    }

    // And the gate, not only the position: an unmet `dependsOn` marks a step
    // `skipped`, so this edge is what makes a failed enablement stop the feel
    // pass rather than silently mistune half the scene.
    for (let i = 0; i < profileIdxs.length; i += 1) {
      const deps = plan.steps[profileIdxs[i]].dependsOn;
      for (let j = 0; j < enableIdxs.length; j += 1) {
        expect(deps).toContain(plan.steps[enableIdxs[j]].id);
      }
    }
  });

  it('re-tunes the player controller `character_setup` wrote, and keeps `canDoubleJump`', async () => {
    await build(crystalRun3d());

    // The Phase 3a deferral inverted the movement system's step order, and this
    // dispatch is what fell out of it. `physics_profile` now runs AFTER
    // `character_setup`, so the live-store read finds the player's
    // CharacterController and `applyPhysicsProfile` takes its merge branch —
    // a branch that was dead on every generated plan before the deferral.
    //
    // Two things have to hold, and neither is visible anywhere else:
    //   1. the merge re-sends the numbers `character_setup` already wrote, not
    //      a second opinion — both sides go through `resolvePhysicsProfile`,
    //      but nothing asserted they agree; and
    //   2. `canDoubleJump`, which the profile does not own, SURVIVES.
    //      `update_game_component` replaces the whole component engine-side
    //      (`build_game_component` merges `properties` onto the type's
    //      `Default`), so a merge that dropped it would silently reset the
    //      field to the engine default — the PF-1118 data loss, and invisible
    //      because `dispatchCommand` returns void.
    const id = spawnedIdByName(recorded, 'Player');
    expect(id, 'Player was spawned without a planned id').toBeTruthy();

    const controller = characterControllerFromProfile(resolvePhysicsProfile(FEEL, {}));
    const expectedPayload = {
      entityId: id,
      componentType: 'character_controller',
      properties: {
        speed: controller.speed,
        jumpHeight: controller.jumpHeight,
        gravityScale: controller.gravityScale,
        canDoubleJump: false,
      },
    };

    // The player carries more than one game component (`progression` adds its
    // win condition), so narrow by type — but keep the FULL payload assertion
    // on what is left, since an invented sibling key is the failure mode.
    const controllerAdds = onlyComponentType(
      payloadsOfCommandFor(recorded, 'add_game_component', id!),
      'character_controller',
    );
    expect(controllerAdds, 'character_setup did not add the player controller')
      .toEqual([expectedPayload]);

    const controllerUpdates = onlyComponentType(
      payloadsOfCommandFor(recorded, 'update_game_component', id!),
      'character_controller',
    );
    expect(
      controllerUpdates,
      'the deferred feel pass did not re-tune the player controller — either the '
      + 'profile step ran before character_setup again, or the merge was skipped',
    ).toEqual([expectedPayload]);

    // Order, not just presence: the merge is only meaningful after the add.
    const addIdx = indexOfCommandFor(recorded, 'add_game_component', id!);
    const updateIdx = indexOfCommandFor(recorded, 'update_game_component', id!);
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThan(addIdx);
  });

  it('applies the movement feel to the world geometry, not only the blueprint cast', async () => {
    await build(crystalRun3d());

    // The regression: with the feel pass planned before the world system's
    // `physics_enable`, `resolveStepOutputs('physics_enable')` returned only the
    // Phase 2.5 output, so the ground, platforms and walls the player actually
    // stands on kept default friction and restitution while the player got the
    // design's. Nothing reported it — `dispatchCommand` returns void, and the
    // step still counted its (smaller) entity set as a success.
    const names = spawnedNames(recorded);
    const geometryNames: string[] = [];
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      if (name === 'Ground' || name.startsWith('Platform ') || name.startsWith('Wall ')) {
        geometryNames.push(name);
      }
    }
    expect(geometryNames.length).toBeGreaterThan(1);

    for (let i = 0; i < geometryNames.length; i += 1) {
      const name = geometryNames[i];
      const id = spawnedIdByName(recorded, name);
      expect(id, `${name} was spawned without a planned id`).toBeTruthy();

      const updates = payloadsOfCommandFor(recorded, 'update_physics', id!);
      expect(
        updates.length,
        `${name} received no feel-pass update_physics — the geometry never reached physics_profile`,
      ).toBe(2);
      // FULL payload: `applyPhysicsProfile` builds a PARTIAL `PhysicsPatch` on
      // purpose (body type and collider shape must keep the values the
      // enablement step wrote), so an extra key here is a body being reset.
      expect(updates[1]).toEqual({
        entityId: id,
        gravityScale: expect.any(Number),
        friction: expect.any(Number),
        restitution: expect.any(Number),
      });
    }
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

  it('dispatches every toggle_physics only after the engine has flushed that entity', async () => {
    await build(crystalRun3d());

    // The regression this pins: `physics_enable` used to run in the same JS task
    // as the spawns that precede it (`entitySetupExecutor` returns without
    // yielding and `runPipeline` awaits each executor on a microtask), so every
    // toggle named an entity the engine had not created yet. `dispatchCommand`
    // returns `void` and `apply_physics_toggles` drains unconditionally, so the
    // whole step "succeeded" while enabling nothing.
    let checked = 0;
    for (let i = 0; i < recorded.length; i += 1) {
      const entry = recorded[i];
      if (entry.command !== 'toggle_physics') continue;
      checked += 1;
      expect(
        entry.targetVisible,
        `toggle_physics for ${String(payloadOf(entry)['entityId'])} was dispatched `
        + 'before the engine flushed the spawn, so the engine would drop it',
      ).toBe(true);
    }

    // Verified by mutation: delete the `await waitForEngineFrame()` that
    // `physicsEnableExecutor` performs before its toggle batch and this test
    // goes red, while every other test in the file stays green.
    //
    // A floor, so a change that stops dispatching toggles altogether fails here
    // instead of passing vacuously: player + 2 crystals + the world geometry.
    expect(checked).toBeGreaterThan(4);
  });

  it('dispatches every update_physics only after the engine has flushed that entity', async () => {
    await build(crystalRun3d());

    // Same contract on the patch half, and a stricter one: `apply_physics_updates`
    // needs the entity to exist AND to already carry `PhysicsData`, so an update
    // for an unflushed entity is doubly lost.
    let checked = 0;
    for (let i = 0; i < recorded.length; i += 1) {
      const entry = recorded[i];
      if (entry.command !== 'update_physics') continue;
      checked += 1;
      expect(
        entry.targetVisible,
        `update_physics for ${String(payloadOf(entry)['entityId'])} was dispatched `
        + 'before the engine flushed the spawn',
      ).toBe(true);
    }
    expect(checked).toBeGreaterThan(4);
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

  // -------------------------------------------------------------------------
  // The auto_polish repair path (PF-1213 round 2)
  //
  // `auto_polish` is the LAST step in the plan — it runs AFTER `physics_enable`,
  // so anything it spawns is past the point where every other entity got its
  // body. A repair that adds a ground plane and stops there hands the player a
  // floor with no Rapier collider to stand on, and nothing downstream can cover
  // for it.
  // -------------------------------------------------------------------------

  it('reaches the ground repair when the GDD has no world system', async () => {
    const plan = await build(crystalRunNoWorld3d());

    const verify = plan.steps.find(s => s.executor === 'verify_all_scenes');
    expect(verify, 'the plan carries no verify step to raise the issue').toBeDefined();
    const issues = ((verify!.output ?? {})['issues'] ?? []) as string[];
    expect(issues).toContain('no_ground_plane');

    const polish = plan.steps.find(s => s.executor === 'auto_polish');
    expect(polish, 'the plan carries no auto_polish step to run the repair').toBeDefined();
    expect(polish!.status).toBe('completed');
    const fixes = ((polish!.output ?? {})['fixesApplied'] ?? []) as string[];
    expect(fixes).toContain('Added ground plane');

    // Exactly one — the repair's. `world_build` did not run, so a second Ground
    // would mean this fixture is not exercising the branch it was built for.
    let grounds = 0;
    const names = spawnedNames(recorded);
    for (let i = 0; i < names.length; i += 1) {
      if (names[i] === 'Ground') grounds += 1;
    }
    expect(grounds).toBe(1);
  });

  it('gives the repaired ground plane a real collider, not just a mesh', async () => {
    await build(crystalRunNoWorld3d());

    const id = spawnedIdByName(recorded, 'Ground');
    expect(
      id,
      'the repair spawned a ground with no id, so no later command can name it',
    ).toBeTruthy();

    // THE COLLIDER MUST MATCH THE MESH, which is a claim about the SIZE and not
    // just about the three wire payloads below.
    //
    // `make_collider` (engine/src/core/physics.rs) derives its half-extents from
    // `transform.scale`, and `spawn_entity` carries a position but no scale — so
    // a spawn-and-toggle repair produces a 1x1x1 box centred on the origin whose
    // walkable top face sits ABOVE the mesh the player can see. They would stand
    // on an invisible pedestal and drop into the void one step later, while the
    // fix list says "Added ground plane". Compared against the descriptor
    // `world_build` uses, so the repaired floor and the built one cannot drift.
    const expected = buildDefaultGroundDescriptor('3d');
    const spawnIdx = recorded.findIndex(
      entry => entry.command === 'spawn_entity' && payloadOf(entry)['id'] === id,
    );
    expect(spawnIdx).toBeGreaterThanOrEqual(0);
    expect(payloadOf(recorded[spawnIdx])).toEqual({
      id,
      entityType: expected.entityType,
      name: expected.name,
      position: expected.position,
    });
    expect(payloadsOfCommandFor(recorded, 'update_transform', id!)).toEqual([
      { entityId: id, scale: expected.scale },
    ]);
    // Pinned literally as well: a change that moves the descriptor and this
    // assertion together is exactly what a purely self-referential comparison
    // cannot notice.
    expect(expected.position).toEqual([0, -0.5, 0]);
    expect(expected.scale).toEqual([40, 1, 40]);

    // FULL payloads, both halves. `TogglePhysicsPayload` is exactly
    // `{ entityId, enabled }`, and the patch is what `PHYSICS_ROLE_PROFILES.geometry`
    // describes: solid, immovable, cuboid — the same body `world_build`'s ground
    // gets when the GDD does ask for a world.
    expect(payloadsOfCommandFor(recorded, 'toggle_physics', id!)).toEqual([
      { entityId: id, enabled: true },
    ]);
    expect(payloadsOfCommandFor(recorded, 'update_physics', id!)).toEqual([
      { entityId: id, bodyType: 'fixed', colliderShape: 'cuboid', isSensor: false },
    ]);

    const sizeIdx = indexOfCommandFor(recorded, 'update_transform', id!);
    const toggleIdx = indexOfCommandFor(recorded, 'toggle_physics', id!);
    const updateIdx = indexOfCommandFor(recorded, 'update_physics', id!);
    // The scale has to land before Play: the collider is built from
    // `transform.scale` at the Edit→Play transition and never resized after.
    expect(sizeIdx).toBeGreaterThan(spawnIdx);
    expect(updateIdx).toBeGreaterThan(toggleIdx);
  });

  it('waits for the repaired ground to flush before enabling physics on it', async () => {
    await build(crystalRunNoWorld3d());

    const id = spawnedIdByName(recorded, 'Ground');
    expect(id).toBeTruthy();

    // The repair spawns and enables inside ONE executor, so it is the tightest
    // instance of the deferred-flush gap in the whole pipeline: without the
    // `waitForEngineFrame()` between the two, `apply_physics_toggles` drains a
    // toggle for an entity `apply_spawn_requests` has not created yet and the
    // ground stays collider-less while the step reports success.
    for (const command of ['update_transform', 'toggle_physics', 'update_physics']) {
      const idx = indexOfCommandFor(recorded, command, id!);
      expect(idx, `no ${command} for the repaired ground`).toBeGreaterThanOrEqual(0);
      expect(
        recorded[idx].targetVisible,
        `${command} for the repaired ground was dispatched before the engine flushed the spawn`,
      ).toBe(true);
    }
  });
});
