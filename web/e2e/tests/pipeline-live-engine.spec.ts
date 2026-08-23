import { test, expect } from '../fixtures/editor.fixture';
import {
  E2E_TIMEOUT_ELEMENT_MS,
  E2E_TIMEOUT_INTERACTION_MS,
  E2E_TIMEOUT_TEST_MS,
} from '../constants';
import crystalRun3d from '../fixtures/gdd/crystal-run-3d.json';

/**
 * PF-1202 (#9317): the live-engine gate for the game-creation pipeline.
 *
 * `generatedGamePlayable.integration.test.ts` runs this same GDD against a FAKE
 * bridge that records commands — it proves the pipeline emits the right JSON,
 * and nothing more. `dispatchCommand` returns `void`, so a payload the engine
 * hard-rejects, silently mangles, or routes to a name `route_domain` has never
 * heard of produces no signal in that suite at all (see `.claude/rules/gotchas.md`
 * -> Engine & Game Loop). Every one of those defects is invisible until real
 * Rust reads the bytes.
 *
 * So this spec runs the REAL pipeline against the REAL WASM engine under
 * ANGLE/SwiftShader software WebGL2, and then clicks the REAL Play button. The
 * pass condition is a genuine round trip: `engineMode` is written ONLY by
 * `hooks/events/transformEvents.ts` on the engine's own `ENGINE_MODE_CHANGED`
 * event — `gameSlice.play()` never sets it — so observing `engineMode === 'play'`
 * proves the engine accepted the scene the pipeline built and entered play mode.
 *
 * The GDD is loaded from the SAME fixture the integration suite imports
 * (`e2e/fixtures/gdd/crystal-run-3d.json`). Two gates, one game — otherwise the
 * fast gate and the slow gate drift into testing different things.
 *
 * ASSERTIONS ARE ON OBSERVABLE ENGINE EFFECTS ONLY (scene-graph population,
 * engine-driven `engineMode`, the PlayControls status region), never on the
 * return value of a dispatch.
 *
 * DEFERRED — `game_win` is deliberately NOT asserted here. Winning requires the
 * player to physically reach a collectible under a software rasteriser at an
 * unpinned frame rate, which is not deterministic in CI. It is also the one
 * event with TWO independent once-guards (the engine's `runtime.game_won` in
 * `game_components.rs` and the Zustand `gameWon` flag in `useScriptRunner.ts`),
 * so a flaky assertion here would be read as a guard regression rather than as
 * timing noise. Win-condition behaviour stays covered natively
 * (`game_components.rs::win_condition_tests`) and by the integration suite.
 *
 * DOCUMENTED GAP: SwiftShader is software WebGL2, not WebGPU — this validates
 * command acceptance and the play transition, not rendering correctness.
 */

/** The slice of `editorStore` this spec drives. Types are erased before the
 *  function body reaches the browser, so naming this at module scope is safe
 *  inside `page.evaluate` (a module-scope VALUE would not be). */
type PipelineState = {
  orchestratorStatus: string;
  orchestratorError: string | null;
  pendingGate: { id: string } | null;
  currentPlan: {
    status: string;
    steps: Array<{ id: string; executor: string; status: string }>;
  } | null;
  engineMode: string;
  sceneGraph: { nodes: Record<string, unknown> };
  startDecomposition: (prompt: string, projectType: string) => Promise<void>;
  runPipelineFromPlan: () => Promise<void>;
  resolveGate: (decision: 'approved' | 'rejected') => void;
};

type StoreHandle = { __EDITOR_STORE: { getState: () => PipelineState } };

/**
 * The plan has at most three approval gates (`gate_plan`, `gate_assets`,
 * `gate_final` — planBuilder.ts). The cap is a real bound, not a guess: it stops
 * a gate that re-arms itself from spinning this loop until the test timeout and
 * reporting as a timeout instead of as a bug.
 */
const MAX_GATES = 3;

const TERMINAL = ['completed', 'failed', 'cancelled'];

/**
 * Derived from the shared fixture rather than stored as a second file on
 * purpose: two hand-maintained copies of the same GDD drift, and the negative
 * case is only meaningful while it is the positive case MINUS one thing.
 *
 * That one thing is NOT the progression system. Since PF-1199 the plan-level
 * win-condition guarantee substitutes a `score` condition when a design names no
 * progression, so a no-progression GDD now legitimately COMPLETES and Play is
 * permitted (`generatedGamePlayable.integration.test.ts` asserts exactly that).
 * The shape the guarantee genuinely cannot rescue is a design that placed
 * nothing in the world: with no entities there is nothing to carry a condition,
 * `verify_all_scenes` reports NOT_WINNABLE, and the plan fails.
 */
const emptyWorldGdd = {
  ...crystalRun3d,
  id: 'gdd-empty-world',
  systems: crystalRun3d.systems.filter(s => s.category !== 'progression'),
  scenes: crystalRun3d.scenes.map(scene => ({
    ...scene,
    systems: scene.systems.filter(c => c !== 'progression'),
    entities: [],
  })),
};

/**
 * Serve the two pipeline endpoints locally. Nothing here needs the network: the
 * GDD normally comes from an LLM, and this fixture IS that answer. The GDD's
 * `assetManifest` is empty and no scripts are planned, so no other route is hit.
 */
async function stubPipelineRoutes(
  page: import('@playwright/test').Page,
  gdd: unknown
): Promise<void> {
  await page.route('**/api/game/decompose', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ gdd }),
    })
  );
  // `startDecomposition` reserves tokens when the plan's high-variance estimate
  // is non-zero and REJECTS a non-string / empty id, so this must answer with a
  // real one. The same route also absorbs the fire-and-forget `release` POST
  // that `runPipelineFromPlan` makes in its `finally`.
  await page.route('**/api/game/pipeline', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ reservationId: 'e2e-res' }),
    })
  );
}

/**
 * Drive the pipeline to a terminal status, approving every gate it raises.
 *
 * `runPipelineFromPlan()` does NOT resolve at a gate — `onGateReached` returns a
 * promise that only settles when `resolveGate` is called — so it must be started
 * WITHOUT being awaited inside the evaluate, or the evaluate deadlocks on the
 * first gate and the test dies at its own timeout with no diagnosis.
 */
async function runPipelineApprovingGates(
  page: import('@playwright/test').Page
): Promise<string> {
  await page.evaluate(() => {
    const store = (window as unknown as StoreHandle).__EDITOR_STORE;
    void store.getState().runPipelineFromPlan();
  });

  for (let i = 0; i <= MAX_GATES; i++) {
    const handle = await page.waitForFunction(
      terminal => {
        const state = (
          window as unknown as StoreHandle
        ).__EDITOR_STORE.getState();
        if (state.pendingGate) return { gate: state.pendingGate.id };
        if (terminal.includes(state.orchestratorStatus)) {
          return { done: state.orchestratorStatus };
        }
        return null;
      },
      TERMINAL,
      { timeout: E2E_TIMEOUT_TEST_MS }
    );
    // `waitForFunction` only settles on a truthy return, so the null branch is
    // unreachable — but its type still carries it, and asserting rather than
    // casting keeps an impossible state from becoming a silent skip.
    const outcome = await handle.jsonValue();
    if (!outcome) throw new Error('waitForFunction settled on a falsy value');
    if (outcome.done) return outcome.done;

    await page.evaluate(() => {
      (window as unknown as StoreHandle).__EDITOR_STORE
        .getState()
        .resolveGate('approved');
    });
  }

  throw new Error(
    `pipeline raised more than ${MAX_GATES} approval gates without terminating`
  );
}

/** Read the whole pipeline outcome in one hop, so a failure names its cause. */
function readOutcome(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const state = (window as unknown as StoreHandle).__EDITOR_STORE.getState();
    return {
      orchestratorStatus: state.orchestratorStatus,
      orchestratorError: state.orchestratorError,
      planStatus: state.currentPlan?.status ?? null,
      steps: (state.currentPlan?.steps ?? []).map(s => ({
        executor: s.executor,
        status: s.status,
      })),
      nodeCount: Object.keys(state.sceneGraph?.nodes ?? {}).length,
      engineMode: state.engineMode,
    };
  });
}

test.describe('Pipeline through the live engine @engine @engine-smoke', () => {
  test.beforeEach(async ({ page, editor }) => {
    // Force WebGL2 BEFORE the app loads so loadWasm() never probes WebGPU
    // (SwiftShader cannot drive it) and never burns GPU_INIT_TIMEOUT first.
    // Same persisted key the in-app fallback button writes.
    await page.addInitScript(() => {
      localStorage.setItem('forge:preferred-backend', 'webgl2');
    });
    await editor.load();
  });

  test('generated game builds through the real engine and Play enters play mode', async ({
    page,
  }) => {
    // Software rendering + WASM init + a whole pipeline of engine commands is
    // far past the 90s config cap.
    test.setTimeout(180_000);

    await stubPipelineRoutes(page, crystalRun3d);

    // The engine is live (editor.load() waited on __FORGE_ENGINE_READY), so
    // runPipelineFromPlan's `getCommandDispatcher()` guard will not short it out.
    await expect(page.locator('canvas').first()).toBeVisible({
      timeout: E2E_TIMEOUT_ELEMENT_MS,
    });

    // Decompose resolves at `awaiting_approval`, so it CAN be awaited — unlike
    // runPipelineFromPlan below.
    await page.evaluate(async () => {
      await (window as unknown as StoreHandle).__EDITOR_STORE
        .getState()
        .startDecomposition('collect every crystal', '3d');
    });

    const afterPlanning = await readOutcome(page);
    expect(
      afterPlanning.orchestratorError,
      'decomposition/planning must not error'
    ).toBeNull();
    expect(afterPlanning.orchestratorStatus).toBe('awaiting_approval');
    expect(afterPlanning.steps.length).toBeGreaterThan(0);

    const terminalStatus = await runPipelineApprovingGates(page);
    const outcome = await readOutcome(page);
    expect(
      terminalStatus,
      `pipeline did not complete: ${outcome.orchestratorError ?? 'no error recorded'} / ${JSON.stringify(outcome.steps)}`
    ).toBe('completed');
    expect(outcome.planStatus).toBe('completed');

    // No step may have failed. `skipped` is admitted because some steps are
    // genuinely optional (auto_polish skips when there is nothing to repair),
    // but the steps that MUST have run are pinned by name below — which is a
    // stronger claim than a blanket "all completed", not a weaker one.
    const notOk = outcome.steps.filter(
      s => s.status !== 'completed' && s.status !== 'skipped'
    );
    expect(
      notOk,
      `steps neither completed nor skipped: ${JSON.stringify(notOk)}`
    ).toEqual([]);

    for (const executor of [
      'scene_create',
      'world_build',
      'entity_setup',
      'physics_enable',
      'game_component',
      'verify_all_scenes',
    ]) {
      const matches = outcome.steps.filter(s => s.executor === executor);
      expect(matches.length, `plan has no ${executor} step`).toBeGreaterThan(0);
      expect(
        matches.every(s => s.status === 'completed'),
        `${executor} did not complete: ${JSON.stringify(matches)}`
      ).toBe(true);
    }

    // The engine's OWN view of the world. `sceneGraph.nodes` is written only by
    // the engine's async SCENE_GRAPH_UPDATE event, so a populated graph is proof
    // the spawns were accepted — not proof that commands were sent.
    expect(
      outcome.nodeCount,
      'engine reported an under-populated scene graph'
    ).toBeGreaterThan(5);

    // ---- The real Play button, not the store action. -----------------------
    // PlayControls renders the role="status" indicator ONLY when !isEdit, so its
    // absence/presence is mode-sensitive (the Stop button is always rendered and
    // only toggles `disabled`, so it proves nothing). Filter by role: the string
    // 'Playing' also appears in AnimationInspector.
    const playStatus = page.getByRole('status').filter({ hasText: 'Playing' });
    await expect(playStatus).toHaveCount(0);
    expect(outcome.engineMode).toBe('edit');

    const playBtn = page.locator('button[aria-label="Play"]');
    await expect(playBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await expect(playBtn).toBeEnabled();
    await playBtn.click();

    // engineMode is set ONLY by the ENGINE_MODE_CHANGED handler, so this is a
    // full JS -> WASM -> engine snapshot -> event -> store -> React round trip.
    await page.waitForFunction(
      () =>
        (window as unknown as StoreHandle).__EDITOR_STORE.getState()
          .engineMode === 'play',
      { timeout: E2E_TIMEOUT_INTERACTION_MS }
    );
    await expect(playStatus).toBeVisible({
      timeout: E2E_TIMEOUT_INTERACTION_MS,
    });
  });

  test('a game with nothing in the world fails verification and Play refuses', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await stubPipelineRoutes(page, emptyWorldGdd);

    await page.evaluate(async () => {
      await (window as unknown as StoreHandle).__EDITOR_STORE
        .getState()
        .startDecomposition('a game with nothing in it', '3d');
    });
    expect((await readOutcome(page)).orchestratorStatus).toBe(
      'awaiting_approval'
    );

    const terminalStatus = await runPipelineApprovingGates(page);
    const outcome = await readOutcome(page);

    expect(terminalStatus).toBe('failed');
    expect(outcome.planStatus).toBe('failed');

    // It must fail AT verification, not somewhere upstream — an earlier crash
    // would produce the same plan status for entirely the wrong reason.
    const verify = outcome.steps.filter(s => s.executor === 'verify_all_scenes');
    expect(verify.length, 'plan has no verify_all_scenes step').toBeGreaterThan(
      0
    );
    expect(
      verify.every(s => s.status === 'failed'),
      `verify_all_scenes did not fail: ${JSON.stringify(verify)}`
    ).toBe(true);

    // The pre-play winnability gate (#8542) returns BEFORE dispatching, so the
    // engine is never asked to change mode and stays in edit.
    const playStatus = page.getByRole('status').filter({ hasText: 'Playing' });
    const playBtn = page.locator('button[aria-label="Play"]');
    await expect(playBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await playBtn.click();

    // Give the engine the same budget the positive test allows for a real
    // transition, then assert it did NOT happen — a bare immediate check would
    // pass even if the mode flipped a moment later.
    await page.waitForTimeout(E2E_TIMEOUT_INTERACTION_MS);
    await expect(playStatus).toHaveCount(0);
    expect((await readOutcome(page)).engineMode).toBe('edit');
  });
});
