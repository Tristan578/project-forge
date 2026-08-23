import { test, expect } from '../fixtures/editor.fixture';
import {
  E2E_TIMEOUT_ELEMENT_MS,
  E2E_TIMEOUT_INTERACTION_MS,
  E2E_TIMEOUT_PIPELINE_LIVE_MS,
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
 * pass condition is a genuine round trip: nothing on the Play-button path writes
 * `engineMode`. `gameSlice.play()` only dispatches, so the two writers that
 * exist are `hooks/events/transformEvents.ts`, reacting to the engine's own
 * `ENGINE_MODE_CHANGED` event, and `gameSlice.setEngineMode` — whose two live
 * callers cannot forge a `'play'`. `useScriptRunner.ts` IS mounted by this flow
 * (`CanvasArea.tsx` calls it, `EditorLayout` renders `CanvasArea`), but the one
 * write it makes is `setEngineMode('edit')` from its infinite-loop watchdog
 * (`useScriptRunner.ts:493`). `QuickStartFlow.tsx` does write `'play'`, but only
 * from its own completion handler, and it is rendered on no route this flow
 * visits. Observing `engineMode === 'play'` therefore proves the engine accepted
 * the scene the pipeline built and entered play mode.
 *
 * The GDD is loaded from the SAME fixture the integration suite imports
 * (`e2e/fixtures/gdd/crystal-run-3d.json`). Two gates, one game — otherwise the
 * fast gate and the slow gate drift into testing different things.
 *
 * ASSERTIONS ARE ON OBSERVABLE ENGINE EFFECTS ONLY (scene-graph population,
 * engine-driven `engineMode`, the PlayControls status region, the chat surface),
 * never on the return value of a dispatch.
 *
 * A HARD-REJECTED dispatch is observable in none of those. The pipeline's
 * `ExecutorContext.dispatchCommand` is `=> void`, so a `camera_setup` /
 * `character_setup` / `game_component` payload the engine refuses leaves the
 * step reporting `completed` and surfaces only as the
 * `Engine rejected command '<name>'` line that `editorStore`'s `tracked` wrapper
 * writes to the console. Both tests therefore collect console errors and page
 * errors for their whole lifetime, and assert that ZERO of those console lines
 * name an engine rejection and that ZERO page errors occurred. (Console errors
 * that do NOT name a rejection are tolerated on purpose — an unrelated
 * third-party or React warning must not redden a gate about engine payloads.)
 * That is what makes "every step completed" mean "the engine accepted every
 * command the step sent" rather than merely "no executor threw".
 *
 * That covers HARD rejections only, and the distinction matters when reading a
 * green run. A payload whose keys deserialize to `None` (the wrong-wire-shape
 * and undetectable-typo shapes in the same gotchas entry) is ACCEPTED by the
 * engine and logs nothing, so this gate cannot see it either — what it adds
 * over the integration suite is real deserialization, real routing through
 * `route_domain`, and a real play transition. Payload-shape discipline stays
 * with the pick-based builders and their unit pins.
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

/** The chat surface the pre-play winnability gate writes its refusal into.
 *  `forge-globals.d.ts` declares `__CHAT_STORE` as `unknown`, so the shape has
 *  to be named here the same way `StoreHandle` names the editor store's. */
type ChatHandle = {
  __CHAT_STORE: {
    getState: () => { messages: Array<{ role: string; content: string }> };
  };
};

/** First line of `formatWinnabilityMessage` (`lib/playMode/winnabilityValidator.ts`),
 *  which `gameSlice.play()` hands to `surfaceWinnabilityMessage` before returning.
 *  NOT the `verifyExecutor` wording — that sentence is a different one. */
const WINNABILITY_REFUSAL = "This game can't be won yet:";

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
 * purpose: two hand-maintained copies of the same GDD drift.
 *
 * ONE thing is stripped, and it is the only shape that is still unwinnable.
 * Since PF-1199 the plan-level win-condition guarantee substitutes a `score`
 * condition whenever a design names no progression, so dropping progression
 * alone now legitimately COMPLETES and Play is permitted
 * (`generatedGamePlayable.integration.test.ts` asserts exactly that). With no
 * entities there is nothing for a condition to hang on, so `verify_all_scenes`
 * reports NOT_WINNABLE however the plan was assembled.
 *
 * Progression is deliberately LEFT IN, and that was measured rather than
 * assumed. Running this exact design (progression retained, `entities: []`)
 * through the real `buildPlan` + `runPipeline` records:
 *
 *   plan_present / scene_create / world_build / physics_enable /
 *   camera_setup / physics_profile  -> completed
 *   verify_all_scenes               -> failed, NOT_WINNABLE / NO_WIN_CONDITION
 *   auto_polish                     -> skipped
 *
 * No `game_component` step is planned at all — the progression system has no
 * entities to bind a collectible to — so nothing upstream can fail first and
 * pre-empt the verification step the assertion below reads. Stripping
 * progression as well would only remove a system whose presence the failure
 * does not depend on.
 */
const emptyWorldGdd = {
  ...crystalRun3d,
  id: 'gdd-empty-world',
  scenes: crystalRun3d.scenes.map(scene => ({
    ...scene,
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
  // Declared for the whole describe rather than per test so that the cold WASM
  // boot inside `beforeEach` is explicitly covered by the same budget: Playwright
  // charges hook time to the test the hook ran for. `editor.load()` also seeds
  // the WebGL2 backend preference (SwiftShader cannot drive WebGPU).
  test.describe.configure({ timeout: E2E_TIMEOUT_PIPELINE_LIVE_MS });

  let consoleErrors: string[] = [];
  let pageErrors: string[] = [];

  test.beforeEach(async ({ page, editor }) => {
    consoleErrors = [];
    pageErrors = [];
    // Registered before the first navigation, so these cover the whole test
    // including engine boot — see `expectNoEngineRejections`.
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await editor.load();
  });

  /**
   * The one assertion that can see a hard-rejected dispatch.
   *
   * `ExecutorContext.dispatchCommand` is `=> void`, so an executor whose payload
   * the engine refuses still reports its step `completed`. The only trace is the
   * `Engine rejected command '<name>': <err>` line `editorStore`'s `tracked`
   * wrapper writes (unthrottled — only the Sentry report is deduped). Page
   * errors are asserted alongside it because an uncaught exception in the
   * command path would likewise leave the step list looking healthy.
   */
  function expectNoEngineRejections(): void {
    expect(consoleErrors.filter((line) => line.includes('Engine rejected command'))).toEqual([]);
    expect(pageErrors).toEqual([]);
  }

  test('generated game builds through the real engine and Play enters play mode', async ({
    page,
  }) => {
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

    // Nothing on this path writes engineMode except the ENGINE_MODE_CHANGED
    // handler, so this is a full JS -> WASM -> engine snapshot -> event ->
    // store -> React round trip.
    await page.waitForFunction(
      () =>
        (window as unknown as StoreHandle).__EDITOR_STORE.getState()
          .engineMode === 'play',
      { timeout: E2E_TIMEOUT_INTERACTION_MS }
    );
    await expect(playStatus).toBeVisible({
      timeout: E2E_TIMEOUT_INTERACTION_MS,
    });

    // Every step above reported `completed`, which on its own only means no
    // executor threw. This is the assertion that makes it mean the engine
    // accepted the commands those steps sent.
    expectNoEngineRejections();
  });

  test('a game with nothing in the world fails verification and Play refuses', async ({
    page,
  }) => {
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

    // Wait on the POSITIVE signal the refusal produces, not on the absence of a
    // transition. `play()` calls `surfaceWinnabilityMessage` before returning,
    // which appends a `role: 'system'` message to the chat store through a
    // DYNAMIC `import('@/stores/chatStore')` — hence a waitForFunction rather
    // than a synchronous read. Sleeping and asserting nothing happened would
    // pass just as readily against a dead engine or an unwired button.
    await page.waitForFunction(
      (needle) => {
        const chat = (window as unknown as ChatHandle).__CHAT_STORE;
        return (chat?.getState().messages ?? []).some(
          (m) => m.role === 'system' && m.content.includes(needle)
        );
      },
      WINNABILITY_REFUSAL,
      { timeout: E2E_TIMEOUT_INTERACTION_MS }
    );

    // Only now is "still in edit" meaningful: the gate demonstrably ran.
    await expect(playStatus).toHaveCount(0);
    expect((await readOutcome(page)).engineMode).toBe('edit');

    // ...and the refusal was a decision, not a casualty. A crashed WASM
    // instance would satisfy everything above, so make the engine do real work:
    // `spawn_entity` is queued in Rust and only reaches `sceneGraph.nodes` when
    // the engine emits SCENE_GRAPH_UPDATE back. (`cube` is lowercase because
    // `EntityType::from_str` is — a wrong spelling would be a hard reject, which
    // `expectNoEngineRejections` below would then catch.)
    const before = (await readOutcome(page)).nodeCount;
    // The return value is load-bearing: `false` means the hook is wired but
    // `getCommandDispatcher()` handed back nothing (no live engine), and
    // `undefined` means the hook itself is absent (`NEXT_PUBLIC_E2E_HOOKS` off).
    // Both would otherwise reach the reader as an opaque waitForFunction
    // timeout on `nodeCount` rather than as a named cause.
    const dispatched = await page.evaluate(() =>
      window.__FORGE_DISPATCH?.('spawn_entity', { entityType: 'cube' })
    );
    expect(dispatched).toBe(true);
    await page.waitForFunction(
      (n) =>
        Object.keys(
          (window as unknown as StoreHandle).__EDITOR_STORE.getState().sceneGraph
            ?.nodes ?? {}
        ).length > n,
      before,
      { timeout: E2E_TIMEOUT_INTERACTION_MS }
    );

    expectNoEngineRejections();
  });
});
