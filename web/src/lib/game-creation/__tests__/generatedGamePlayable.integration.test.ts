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
import { zBehavior } from '../behaviorVocabulary';
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
 *
 * `toggle_physics` is played back for the same reason. `SceneNode.components` is
 * the engine's own `detect_components` output, and `'PhysicsEnabled'` appears
 * there exactly when the entity carries the marker that `toggle_physics` inserts.
 * `verify_all_scenes` reads that string to find a character the engine will never
 * hand a collider — and so never a kinematic controller (PF-1214). A fake that
 * left `components` permanently empty would report every generated character as
 * broken, which is a fact about the fake, not about the pipeline.
 */
function attachFakeEngine(harness: TestHarness): Recorded[] {
  const recorded: Recorded[] = [];

  harness.dispatch.mockImplementation((command: string, payload: unknown) => {
    recorded.push({ command, payload });

    // Read key by key behind `Object.hasOwn` — the payload crossed a plan
    // boundary and a bare index would walk the prototype chain.
    const bag = (payload ?? {}) as Record<string, unknown>;

    if (command === 'toggle_physics') {
      const rawTarget = Object.hasOwn(bag, 'entityId') ? bag['entityId'] : undefined;
      const enabled = Object.hasOwn(bag, 'enabled') ? bag['enabled'] === true : false;
      if (typeof rawTarget !== 'string' || rawTarget === '') return;
      const existing = harness.getState().sceneGraph.nodes[rawTarget];
      if (existing === undefined) return;
      const has = existing.components.includes('PhysicsEnabled');
      if (enabled === has) return;
      const components = enabled
        ? [...existing.components, 'PhysicsEnabled']
        : existing.components.filter(name => name !== 'PhysicsEnabled');
      harness.getState().updateNode(rawTarget, { components });
      return;
    }

    if (command !== 'spawn_entity') return;

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
                // Optional and CLOSED (PF-1114). Declared here so the shared
                // fixture CAN carry one: `.strict()` would otherwise reject a
                // behaviour added to `crystal-run-3d.json` for the live-engine
                // gate, at module load, with the whole file red.
                behavior: zBehavior.optional(),
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
 *
 * Progression is deliberately RETAINED — only `entities` is emptied. Stripping
 * it too would make this the easy case (no progression, so nothing even tries
 * to plan a goal) and would leave the harder one untested. It also keeps this
 * byte-identical to `emptyWorldGdd` in `e2e/tests/pipeline-live-engine.spec.ts`,
 * whose comment cites the plan shape asserted below; two negative fixtures that
 * differ are two gates quietly testing different games.
 */
function designWithNothingInIt(): OrchestratorGDD {
  const gdd = crystalRun3d();
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
    // A throw rather than an `expect`: it asserts the same thing and also
    // NARROWS, so the scene-graph lookup further down indexes with a `string`
    // instead of an `unknown`.
    if (typeof playerId !== 'string' || playerId === '') {
      throw new Error('the character controller was wired with no entityId');
    }

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

    // Physics was switched ON for the character. This is the golden path, not a
    // detail: `manage_character_controller_lifecycle` only attaches Rapier's
    // kinematic controller to an entity that already carries a `Collider`, and a
    // collider only ever arrives from `manage_physics_lifecycle`, which queries
    // `With<PhysicsEnabled>`. Skip this and the character is never CONSIDERED for
    // a controller — no error, no rejected command — and walks through walls
    // (PF-1214).
    expect(
      recorded.some(
        r =>
          r.command === 'toggle_physics' &&
          (r.payload as Record<string, unknown>)['entityId'] === playerId &&
          (r.payload as Record<string, unknown>)['enabled'] === true,
      ),
    ).toBe(true);
    expect(harness.getState().sceneGraph.nodes[playerId].components).toContain('PhysicsEnabled');

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

    // The failure has to land ON `verify_all_scenes`, not upstream of it: a
    // plan that died earlier would satisfy every assertion below about the
    // plan being failed while proving nothing about verification. Progression
    // is present here and still plans no `game_component` step at all, because
    // it has no entity to bind a collectible to — which is exactly why nothing
    // upstream can pre-empt the check. This is the shape
    // `e2e/tests/pipeline-live-engine.spec.ts` documents for `emptyWorldGdd`.
    expect(stepsFor(plan, 'game_component')).toEqual([]);
    for (const executor of [
      'plan_present',
      'scene_create',
      'world_build',
      'physics_enable',
      'camera_setup',
      'physics_profile',
    ]) {
      const steps = stepsFor(plan, executor);
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.map(step => step.status)).toEqual(steps.map(() => 'completed'));
    }

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

/**
 * PF-1114 — per-entity behaviour, through the REAL pipeline.
 *
 * The unit suites prove the plan SHAPE. This proves the plan RUNS: real
 * `buildPlan`, real system registry, real executors, real store, and the same
 * fake bridge every other case in this file uses. The three assertions that
 * matter are the ones a unit test cannot make —
 *
 *  - the follower command reaches the store bound to an id the scene graph can
 *    resolve (a component bound to a name is a silent no-op in the engine);
 *  - `fetchAI` is never called, which is what makes this the cheap path;
 *  - the game is still winnable afterwards, so behaviour is additive rather
 *    than something that displaces the win condition.
 */
describe('generated behaviour runs end to end (PF-1114)', () => {
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

  /**
   * Crystal Run plus a cast that DOES things: one chaser, one patroller, one
   * deliberately-still statue, and a challenge system so the follower pass that
   * plans by default is live at the same time. That overlap is the point — it
   * is where a double writer would show up.
   */
  function crystalRunWithBehaviors(): OrchestratorGDD {
    const gdd = crystalRun3d();
    return {
      ...gdd,
      id: 'gdd-crystal-run-behaviors',
      systems: [
        ...gdd.systems,
        { category: 'challenge', type: 'enemies', config: {}, priority: 'core', dependsOn: [] },
      ],
      scenes: gdd.scenes.map(scene => ({
        ...scene,
        systems: [...scene.systems, 'challenge' as const],
        entities: [
          ...scene.entities,
          { name: 'Bat', role: 'enemy' as const, systems: [], appearance: 'primitive:sphere', behavior: 'chase' as const },
          { name: 'Guard', role: 'enemy' as const, systems: [], appearance: 'primitive:cube', behavior: 'patrol' as const },
          { name: 'Statue', role: 'enemy' as const, systems: [], appearance: 'primitive:cube', behavior: 'idle' as const },
          { name: 'Rabbit', role: 'npc' as const, systems: [], appearance: 'primitive:capsule', behavior: 'flee' as const },
        ],
      })),
    };
  }

  async function build(gdd: OrchestratorGDD): Promise<OrchestratorPlan> {
    const plan = buildPlan(gdd, 'project-under-test', 'creator', 1_000_000);
    return runPipeline(plan, EXECUTOR_REGISTRY, makeContext(harness, gdd.projectType));
  }

  it('every step runs, and the behaviours reach the engine bound to real ids', async () => {
    const plan = await build(crystalRunWithBehaviors());

    expect(plan.status).toBe('completed');
    expect(plan.steps.filter(s => s.status !== 'completed')).toEqual([]);

    const nodes = harness.getState().sceneGraph.nodes;
    const batId = spawnedIdByName(recorded, 'Bat');
    const playerId = spawnedIdByName(recorded, 'Player');
    if (typeof batId !== 'string' || typeof playerId !== 'string') {
      throw new Error('the behaviour cast was never spawned');
    }

    // ONE follower for the chaser, bound to the player, and the id resolves in
    // the scene graph the engine would match against.
    const followers = wireComponentsOfType(recorded, 'follower');
    const chaser = followers.filter(f => f['entityId'] === batId);
    expect(chaser).toHaveLength(1);
    const target = (chaser[0]['properties'] as Record<string, unknown>)['targetEntityId'];
    expect(target).toBe(playerId);
    expect(nodes[target as string]).toBeDefined();

    // The patroller travels; the statue does not.
    const platforms = wireComponentsOfType(recorded, 'moving_platform');
    expect(platforms.map(p => p['entityId'])).toEqual([spawnedIdByName(recorded, 'Guard')]);
    const statueId = spawnedIdByName(recorded, 'Statue');
    expect(followers.some(f => f['entityId'] === statueId)).toBe(false);
    expect(platforms.some(p => p['entityId'] === statueId)).toBe(false);

    // The fleeing NPC gets a script, attached by id.
    const scripts = recorded.filter(entry => entry.command === 'set_script');
    expect(scripts).toHaveLength(1);
    const scriptPayload = scripts[0].payload as Record<string, unknown>;
    expect(scriptPayload['entityId']).toBe(spawnedIdByName(recorded, 'Rabbit'));
    expect(String(scriptPayload['source'])).toContain(playerId);
  });

  it('makes no network call — a template is not a generated script', async () => {
    await build(crystalRunWithBehaviors());
    expect(fetchAI).not.toHaveBeenCalled();
  });

  it('plans exactly one follower per enemy despite two would-be writers', async () => {
    // The challenge system plans a follower for every enemy by default; the
    // behaviour pass plans one for every `chase`. Two components on one entity
    // is the regression this pins.
    await build(crystalRunWithBehaviors());

    const followers = wireComponentsOfType(recorded, 'follower');
    const byEntity = new Map<string, number>();
    for (const follower of followers) {
      const id = String(follower['entityId']);
      byEntity.set(id, (byEntity.get(id) ?? 0) + 1);
    }
    for (const [entityId, count] of byEntity) {
      expect({ entityId, count }).toEqual({ entityId, count: 1 });
    }
    // Bat chases (behaviour pass). Guard patrols and Statue idles, so the
    // challenge default must not have claimed either.
    expect(byEntity.size).toBe(1);
    expect([...byEntity.keys()]).toEqual([spawnedIdByName(recorded, 'Bat')]);
  });

  it('is still winnable with a behaving cast in it', async () => {
    await build(crystalRunWithBehaviors());
    const state = harness.getState();
    const report = validateWinnability(state.sceneGraph, state.allGameComponents);
    expect(report.winnable).toBe(true);
    expect(report.issues).toEqual([]);
  });
});
