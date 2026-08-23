/**
 * PF-1199 — a generated game must be PLAYABLE, end to end.
 *
 * These suites drive the REAL pipeline: the real `buildPlan`, the real system
 * registry, the real `EXECUTOR_REGISTRY`, the real editor store (all 20 slices,
 * via the integration harness) and the real `validateWinnability` — the same
 * function `gameSlice.play()` calls before it will allow Edit -> Play. Nothing
 * under test is mocked.
 *
 * Exactly two things are faked, and both sit outside the product:
 *
 *  1. **The WASM bridge.** `dispatchCommand` returns void in production, so the
 *     fake also plays back the half of the engine the pipeline depends on: a
 *     `spawn_entity` command feeds a node into the scene graph the way the
 *     engine's scene-graph event would. Without that, `camera_setup` finds no
 *     camera and a `reachGoal` target resolves to nothing — for reasons that
 *     have nothing to do with the code under test.
 *  2. **`fetchAI`.** The pipeline's only network edge (`customScriptExecutor`).
 *     No GDD here plans a custom script, so it is stubbed to PROVE the run
 *     needs no network, not to stand in for one.
 *
 * The negative case is the point of the file as much as the positive ones: a
 * GDD with no progression system plans no `winCondition`, `verify_all_scenes`
 * must say so, the plan must fail, and `play()` must refuse. A suite that can
 * only go green is not a suite.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted above the imports by vitest. `customScriptExecutor` is the only
// module in the pipeline that reaches the network.
vi.mock('@/lib/ai/client', () => ({
  fetchAI: vi.fn(async () => 'forge.on("update", () => {});'),
}));

import { z } from 'zod';
import { fetchAI } from '@/lib/ai/client';
import { buildPlan } from '../planBuilder';
import { runPipeline } from '../pipelineRunner';
import { EXECUTOR_REGISTRY } from '../executors';
import type {
  ExecutorContext,
  FeelDirective,
  OrchestratorGDD,
  OrchestratorPlan,
  PlanStep,
} from '../types';
import { zSystemCategory, zEntityRole } from '../types';
import { GDD_SCOPES } from '@/lib/config/enums';
import { validateWinnability } from '@/lib/playMode/winnabilityValidator';
import { setWinnabilityStateReader } from '@/stores/slices';
import { createTestHarness } from '@/__integration__/harness';
import type { TestHarness } from '@/__integration__/harness';
import type { SceneNode } from '@/stores/slices/types';
import crystalRun3dFixture from '../../../../e2e/fixtures/gdd/crystal-run-3d.json';

// ---------------------------------------------------------------------------
// Fake engine
// ---------------------------------------------------------------------------

interface Recorded {
  command: string;
  payload: unknown;
}

/**
 * Replace the harness dispatcher with a recorder that ALSO simulates the one
 * engine round trip the pipeline genuinely depends on.
 *
 * `entitySetupExecutor` and `worldBuildExecutor` dispatch `spawn_entity` and
 * never write the store — the scene graph is only ever populated by an engine
 * event. Three later steps read it live (`camera_setup` looks for the camera,
 * `verify_all_scenes` counts entities, and the winnability gate resolves a
 * `reachGoal` target through `sceneGraph.nodes`), so a test that skipped this
 * would be measuring a scene that never got built.
 */
function attachFakeEngine(harness: TestHarness): Recorded[] {
  const recorded: Recorded[] = [];

  harness.dispatch.mockImplementation((command: string, payload: unknown) => {
    recorded.push({ command, payload });
    if (command !== 'spawn_entity') return;

    // Read key by key behind `Object.hasOwn` — the payload crossed a plan
    // boundary and a bare index would walk the prototype chain.
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
    // Replaced by `runPipeline` with a live resolver over the plan's steps.
    resolveStepOutput: () => undefined,
    resolveStepOutputs: () => [],
  };
}

// ---------------------------------------------------------------------------
// GDD fixtures — shaped the way the real GDD generator emits them
// ---------------------------------------------------------------------------

/**
 * The 3D GDD is loaded from `web/e2e/fixtures/gdd/crystal-run-3d.json` rather
 * than declared here, because TWO gates now assert on the same generated game:
 * this suite (fast, fake bridge) and the live-engine Playwright gate
 * `web/e2e/tests/pipeline-live-engine.spec.ts` (real WASM, real Play button).
 * One fixture is what stops the two from silently testing different games.
 *
 * It is PARSED, not cast. A `resolveJsonModule` import widens every literal
 * (`'3d'` becomes `string`), so `as OrchestratorGDD` was the only way to make
 * it type-check — and a cast is exactly as happy with a fixture whose fields
 * have been renamed or dropped, which is the failure this shared file makes
 * possible. The schema below is `.strict()`, so a renamed field fails twice
 * (missing here, unknown there) at module load, naming the field, instead of
 * surfacing as a mystery mid-pipeline.
 *
 * The schema is pinned to the interface from the other side too: `parse()`'s
 * result is annotated `OrchestratorGDD`, so a field ADDED to the interface
 * without being added here is a compile error rather than a silent gap.
 */
const zOrchestratorGdd = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    systems: z.array(
      z
        .object({
          category: zSystemCategory,
          type: z.string(),
          config: z.record(z.string(), z.unknown()),
          priority: z.enum(['core', 'secondary', 'polish']),
          dependsOn: z.array(zSystemCategory),
        })
        .strict()
    ),
    scenes: z.array(
      z
        .object({
          name: z.string(),
          purpose: z.string(),
          systems: z.array(zSystemCategory),
          entities: z.array(
            z
              .object({
                name: z.string(),
                role: zEntityRole,
                systems: z.array(zSystemCategory),
                appearance: z.string(),
              })
              .strict()
          ),
          transitions: z.array(
            z.object({ to: z.string(), trigger: z.string() }).strict()
          ),
        })
        .strict()
    ),
    assetManifest: z.array(
      z
        .object({
          type: z.enum(['3d-model', 'texture', 'sound', 'music', 'voice', 'sprite']),
          description: z.string(),
          entityRef: z.string().optional(),
          styleDirective: z.string(),
          priority: z.enum(['required', 'nice-to-have']),
          fallback: z.string(),
        })
        .strict()
    ),
    estimatedScope: z.enum(GDD_SCOPES),
    styleDirective: z.string(),
    feelDirective: z
      .object({
        mood: z.string(),
        pacing: z.enum(['slow', 'medium', 'fast']),
        weight: z.enum(['floaty', 'light', 'medium', 'heavy', 'weighty']),
        referenceGames: z.array(z.string()),
        oneLiner: z.string(),
      })
      .strict(),
    constraints: z.array(z.string()),
    projectType: z.enum(['2d', '3d']),
  })
  .strict();

/**
 * Parsed once, at module load, so a bad fixture fails the whole file loudly
 * rather than one assertion obscurely.
 */
const CRYSTAL_RUN_3D: OrchestratorGDD = zOrchestratorGdd.parse(crystalRun3dFixture);

const FEEL: FeelDirective = CRYSTAL_RUN_3D.feelDirective;

/**
 * Collect-everything platformer in 3D.
 *
 * `structuredClone` is not defensive: three call sites take this GDD and one of
 * them (`crystalRunWithoutProgression`) rewrites it, so a shared reference would
 * mutate another test's input.
 */
function crystalRun3d(): OrchestratorGDD {
  return structuredClone(CRYSTAL_RUN_3D);
}

/** Reach-the-exit side-scroller in 2D. */
function tunnelDash2d(): OrchestratorGDD {
  return {
    id: 'gdd-tunnel-dash',
    title: 'Tunnel Dash',
    description: 'Run right, grab a coin, reach the portal.',
    projectType: '2d',
    estimatedScope: 'small',
    styleDirective: 'chunky pixel art',
    feelDirective: { ...FEEL, pacing: 'fast', weight: 'light' },
    constraints: [],
    systems: [
      { category: 'movement', type: 'sideScroller', config: {}, priority: 'core', dependsOn: [] },
      {
        category: 'world',
        type: 'platformer',
        config: { width: 60, platforms: 3, bounds: true },
        priority: 'core',
        dependsOn: [],
      },
      { category: 'camera', type: 'sideScroller', config: {}, priority: 'core', dependsOn: ['movement'] },
      {
        category: 'progression',
        type: 'reach-the-exit',
        config: {},
        priority: 'core',
        dependsOn: ['movement'],
      },
    ],
    scenes: [
      {
        name: 'Tunnel',
        purpose: 'The only level.',
        systems: ['movement', 'world', 'camera', 'progression'],
        entities: [
          { name: 'Player', role: 'player', systems: ['movement'], appearance: 'primitive:capsule' },
          { name: 'Exit Portal', role: 'trigger', systems: [], appearance: 'primitive:cube' },
          { name: 'Coin', role: 'interactable', systems: [], appearance: 'primitive:sphere' },
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
 * The same 3D game with the progression system removed — nothing else changes.
 * Progression is the only system that plans a `winCondition`, so this is the
 * shape of every generated game before PF-1199.
 */
function crystalRunWithoutProgression(): OrchestratorGDD {
  const gdd = crystalRun3d();
  return {
    ...gdd,
    id: 'gdd-crystal-run-no-progression',
    systems: gdd.systems.filter(s => s.category !== 'progression'),
    scenes: gdd.scenes.map(scene => ({
      ...scene,
      systems: scene.systems.filter(c => c !== 'progression'),
    })),
  };
}

/**
 * A design that named systems but placed nothing in the world.
 *
 * This is the one shape the plan-level win-condition guarantee cannot rescue:
 * a `winCondition` component has to ride on an entity, and binding one to an
 * empty id would be rejected by the engine — which fails the whole plan instead
 * of reporting the real problem. So the plan says so and the game stays
 * unwinnable, on purpose.
 */
function designWithNothingInIt(): OrchestratorGDD {
  const gdd = crystalRunWithoutProgression();
  return {
    ...gdd,
    id: 'gdd-empty-world',
    scenes: gdd.scenes.map(scene => ({ ...scene, entities: [] })),
  };
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

function stepsFor(plan: OrchestratorPlan, executor: string): PlanStep[] {
  return plan.steps.filter(s => s.executor === executor);
}

function wireComponentsOfType(recorded: Recorded[], componentType: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const entry of recorded) {
    if (entry.command !== 'add_game_component') continue;
    const bag = (entry.payload ?? {}) as Record<string, unknown>;
    if (Object.hasOwn(bag, 'componentType') && bag['componentType'] === componentType) {
      out.push(bag);
    }
  }
  return out;
}

/**
 * The engine id a named entity was spawned with.
 *
 * Binding is asserted against THIS, never against the name: the engine matches
 * a component to its entity on the `EntityId` component, so a win condition
 * carrying a name resolves to nothing and the game silently cannot be won.
 */
function spawnedIdByName(recorded: Recorded[], name: string): string | undefined {
  for (const entry of recorded) {
    if (entry.command !== 'spawn_entity') continue;
    const bag = (entry.payload ?? {}) as Record<string, unknown>;
    if (bag['name'] !== name) continue;
    const id = bag['id'];
    if (typeof id === 'string') return id;
  }
  return undefined;
}

function spawnedNames(recorded: Recorded[]): string[] {
  const names: string[] = [];
  for (const entry of recorded) {
    if (entry.command !== 'spawn_entity') continue;
    const bag = (entry.payload ?? {}) as Record<string, unknown>;
    const name = Object.hasOwn(bag, 'name') ? bag['name'] : undefined;
    if (typeof name === 'string') names.push(name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('generated game is playable (end to end)', () => {
  let harness: TestHarness;
  let recorded: Recorded[];

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetchAI).mockClear();
    harness = createTestHarness();
    recorded = attachFakeEngine(harness);

    // The Play gate reads this seam. It is a module-level singleton, so it must
    // be set here and cleared in afterEach or it leaks across files in the
    // threads pool.
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

  // -------------------------------------------------------------------------

  it('3D collect-all: every step runs, the scene is winnable, and Play is permitted', async () => {
    const gdd = crystalRun3d();
    const plan = await build(gdd);

    expect(plan.status).toBe('completed');
    expect(plan.steps.filter(s => s.status !== 'completed')).toEqual([]);

    // (B) the game actually got built --------------------------------------
    const names = spawnedNames(recorded);
    // Blueprint entities.
    expect(names).toEqual(expect.arrayContaining(['Player', 'Crystal Alpha', 'Crystal Beta', 'Main Camera']));
    // World geometry — the thing that stops the player falling through a void.
    expect(names).toContain('Ground');
    expect(names.filter(n => n.startsWith('Platform ')).length).toBeGreaterThan(0);

    // A player the engine can drive.
    const controllers = wireComponentsOfType(recorded, 'character_controller');
    expect(controllers).toHaveLength(1);
    const playerId = controllers[0]['entityId'];
    expect(typeof playerId).toBe('string');

    // One collectible per interactable, at the value the GDD asked for.
    const collectibles = wireComponentsOfType(recorded, 'collectible');
    expect(collectibles).toHaveLength(2);
    for (const collectible of collectibles) {
      expect((collectible['properties'] as Record<string, unknown>)['value']).toBe(25);
    }

    // The win condition itself.
    const winConditions = wireComponentsOfType(recorded, 'win_condition');
    expect(winConditions).toHaveLength(1);
    expect(winConditions[0]['entityId']).toBe(playerId);
    expect((winConditions[0]['properties'] as Record<string, unknown>)['conditionType']).toBe('collectAll');

    // The camera was configured AND made active — configuring one the engine is
    // not rendering through is a no-op the player would never see.
    expect(recorded.some(r => r.command === 'set_game_camera')).toBe(true);
    expect(recorded.some(r => r.command === 'set_active_game_camera')).toBe(true);

    // (D) verify reports honestly ------------------------------------------
    const verify = stepsFor(plan, 'verify_all_scenes')[0];
    expect(verify.status).toBe('completed');
    expect(verify.output?.['winnable']).toBe(true);
    expect(verify.output?.['winnabilityIssues']).toEqual([]);
    expect(verify.output?.['issues']).toEqual([]);
    expect(verify.output?.['passed']).toBe(true);

    // The REAL gate, over the REAL store state --------------------------------
    const state = harness.getState();
    const report = validateWinnability(state.sceneGraph, state.allGameComponents);
    expect(report.winnable).toBe(true);
    expect(report.issues).toEqual([]);

    // ...and therefore Play is permitted.
    const before = recorded.length;
    harness.getState().play();
    expect(recorded.slice(before).some(r => r.command === 'play')).toBe(true);

    // No network was needed to build a playable game.
    expect(fetchAI).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------

  it('2D reach-the-exit: the win condition binds to a real entity and Play is permitted', async () => {
    const gdd = tunnelDash2d();
    const plan = await build(gdd);

    expect(plan.status).toBe('completed');
    expect(plan.steps.filter(s => s.status !== 'completed')).toEqual([]);

    const names = spawnedNames(recorded);
    expect(names).toEqual(expect.arrayContaining(['Player', 'Exit Portal', 'Coin', 'Main Camera']));
    expect(names).toContain('Ground');

    const controllers = wireComponentsOfType(recorded, 'character_controller');
    expect(controllers).toHaveLength(1);
    // 2D characters get a rig; a capsule in a side-scroller is a broken sprite.
    expect(recorded.some(r => r.command === 'create_skeleton2d')).toBe(true);

    const winConditions = wireComponentsOfType(recorded, 'win_condition');
    expect(winConditions).toHaveLength(1);
    const props = winConditions[0]['properties'] as Record<string, unknown>;
    expect(props['conditionType']).toBe('reachGoal');

    // The target must be an entity the engine really has — the gate resolves it
    // through the scene graph, and a name would never match.
    const state = harness.getState();
    const targetId = props['targetEntityId'];
    expect(typeof targetId).toBe('string');
    const target = state.sceneGraph.nodes[targetId as string];
    expect(target?.name).toBe('Exit Portal');

    const verify = stepsFor(plan, 'verify_all_scenes')[0];
    expect(verify.status).toBe('completed');
    expect(verify.output?.['winnable']).toBe(true);
    expect(verify.output?.['winnabilityIssues']).toEqual([]);

    const report = validateWinnability(state.sceneGraph, state.allGameComponents);
    expect(report.winnable).toBe(true);
    expect(report.issues).toEqual([]);

    const before = recorded.length;
    harness.getState().play();
    expect(recorded.slice(before).some(r => r.command === 'play')).toBe(true);
    expect(fetchAI).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // (C) The shape EVERY generated game had before PF-1199: a design that never
  // said how it is won. Most GDDs declare no progression system, and until the
  // plan-level guarantee existed that meant no win condition, so `play()`
  // refused and the generated game could not be started at all.
  // -------------------------------------------------------------------------

  it('a GDD with no progression system still gets a winnable goal, and Play is permitted', async () => {
    const gdd = crystalRunWithoutProgression();
    const plan = await build(gdd);

    expect(plan.status).toBe('completed');

    // Exactly one condition — a substituted goal must never sit alongside a
    // designed one, because that is a second rule the player was never told.
    const conditions = wireComponentsOfType(recorded, 'win_condition');
    expect(conditions).toHaveLength(1);

    // Satisfiable: `score` is the one condition that needs no further
    // structure, and the validator refuses a target that is zero, negative or
    // non-finite.
    const props = conditions[0]['properties'] as Record<string, unknown>;
    expect(props['conditionType']).toBe('score');
    expect(Number.isFinite(props['targetScore'] as number)).toBe(true);
    expect(props['targetScore'] as number).toBeGreaterThan(0);

    // Bound to the player by engine id.
    expect(conditions[0]['entityId']).toBe(spawnedIdByName(recorded, 'Player'));

    // The rest of the game is built as before — the guarantee adds a goal, it
    // does not change the world around it.
    const names = spawnedNames(recorded);
    expect(names).toEqual(expect.arrayContaining(['Player', 'Main Camera', 'Ground']));
    expect(wireComponentsOfType(recorded, 'character_controller')).toHaveLength(1);

    const verify = stepsFor(plan, 'verify_all_scenes')[0];
    expect(verify.status).toBe('completed');
    expect(verify.output?.['winnable']).toBe(true);
    expect(verify.output?.['winnabilityIssues']).toEqual([]);

    const state = harness.getState();
    const report = validateWinnability(state.sceneGraph, state.allGameComponents);
    expect(report.winnable).toBe(true);
    expect(report.issues).toEqual([]);

    const before = recorded.length;
    harness.getState().play();
    expect(recorded.slice(before).some(r => r.command === 'play')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // (D) The negative. A game the guarantee genuinely cannot rescue must NOT
  // reach the Play button, and verification must say so out loud rather than
  // reporting a playability it never checked.
  // -------------------------------------------------------------------------

  it('a design with nothing in the world has no goal to give, fails verification, and Play refuses', async () => {
    const gdd = designWithNothingInIt();
    const plan = await build(gdd);

    // Nothing to carry a condition, so none was planned — and crucially none
    // was planned bound to an empty id, which the engine would reject and which
    // would fail the plan for the wrong reason.
    expect(wireComponentsOfType(recorded, 'win_condition')).toEqual([]);

    // verify reports honestly on the failing side.
    const verify = stepsFor(plan, 'verify_all_scenes')[0];
    expect(verify.status).toBe('failed');
    expect(verify.error?.code).toBe('NOT_WINNABLE');
    expect(verify.output?.['winnable']).toBe(false);
    expect(verify.output?.['winnabilityIssues']).toEqual(['NO_WIN_CONDITION']);
    // The explanation rides on `output.warnings`, which is the only channel
    // `collectStepWarnings` reads — an `error` alone never reaches the panel.
    expect(String((verify.output?.['warnings'] as string[])?.join('\n'))).toContain('NO_WIN_CONDITION');

    // `verify_all_scenes` is NOT an optional step, so an unwinnable game fails
    // the whole plan rather than being quietly polished and handed over.
    expect(plan.status).toBe('failed');
    expect(stepsFor(plan, 'auto_polish')[0].status).toBe('skipped');

    // The plan says what went wrong in the user's own terms, rather than
    // leaving them to infer it from a failed step.
    const summary = plan.approvalGates.find(g => g.id === 'gate_final')?.displayData
      .completionSummary;
    expect(String(summary?.warnings.join('\n'))).toMatch(/no goal yet/i);

    // The real gate agrees.
    const state = harness.getState();
    const report = validateWinnability(state.sceneGraph, state.allGameComponents);
    expect(report.winnable).toBe(false);
    expect(report.issues.map(i => i.code)).toEqual(['NO_WIN_CONDITION']);

    // ...and Play refuses. Asserted on the dispatch, not on a store flag: a
    // blocked `play()` returns before it dispatches anything at all.
    const before = recorded.length;
    harness.getState().play();
    expect(recorded.slice(before).some(r => r.command === 'play')).toBe(false);
  });
});
