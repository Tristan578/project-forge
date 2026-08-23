import { test, expect } from '../fixtures/editor.fixture';
import { injectStore, readStore, isStrictMode } from '../helpers/store-injection';
import { E2E_TIMEOUT_LOAD_MS } from '../constants';
// The SAME GDD the pipeline integration test builds from, so the two gates can
// never disagree about what a valid design document looks like.
import crystalRun3dGdd from '../fixtures/gdd/crystal-run-3d.json';

/**
 * E2E tests for the game creation pipeline (E1).
 *
 * Verifies the "describe a game -> AI builds it -> play it" flow by
 * injecting orchestrator state via the store. No real API calls.
 *
 * Spec: specs/2026-04-12-e1-pipeline-integration.md (Deliverable 8)
 */
test.describe('Pipeline Game Creation Flow @ui @dev', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  // -------------------------------------------------------------------------
  // 1. Orchestrator slice is accessible and starts idle
  // -------------------------------------------------------------------------
  test('orchestrator starts in idle status', async ({ page, editor }) => {
    await editor.waitForEditorStore(E2E_TIMEOUT_LOAD_MS);

    const status = await readStore<string>(
      page,
      '__EDITOR_STORE',
      `window.__EDITOR_STORE?.getState?.()?.orchestratorStatus ?? null`,
    );

    if (status !== null || isStrictMode) {
      expect(status).toBe('idle');
    }
  });

  // -------------------------------------------------------------------------
  // 2. Injecting decomposing status shows pipeline activity
  // -------------------------------------------------------------------------
  test('setting decomposing status transitions the orchestrator', async ({ page, editor }) => {
    await editor.waitForEditorStore(E2E_TIMEOUT_LOAD_MS);

    await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      const state = store?.getState?.();
      if (typeof state?.setOrchestratorStatus === 'function') {
        state.setOrchestratorStatus('decomposing');
      }
    `);

    const status = await readStore<string>(
      page,
      '__EDITOR_STORE',
      `window.__EDITOR_STORE?.getState?.()?.orchestratorStatus ?? null`,
    );

    if (status !== null || isStrictMode) {
      expect(status).toBe('decomposing');
    }
  });

  // -------------------------------------------------------------------------
  // 3. Injecting a plan transitions to awaiting_approval with step data
  // -------------------------------------------------------------------------
  test('setPlan populates plan and step statuses', async ({ page, editor }) => {
    await editor.waitForEditorStore(E2E_TIMEOUT_LOAD_MS);

    const injected = await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      const state = store?.getState?.();
      if (typeof state?.setPlan === 'function') {
        state.setPlan({
          id: 'e2e-plan-1',
          projectId: 'e2e-proj-1',
          prompt: 'make a platformer',
          gdd: {
            id: 'e2e-gdd-1',
            title: 'E2E Platformer',
            description: 'A test platformer',
            systems: [],
            scenes: [],
            assetManifest: [],
            estimatedScope: 'small',
            styleDirective: 'default',
            feelDirective: { mood: 'fun', pacing: 'medium', weight: 'medium', referenceGames: [], oneLiner: 'test' },
            constraints: [],
            projectType: '3d',
          },
          steps: [
            { id: 's1', executor: 'scene_create', input: {}, dependsOn: [], maxRetries: 1, optional: false, status: 'pending' },
            { id: 's2', executor: 'entity_setup', input: {}, dependsOn: ['s1'], maxRetries: 1, optional: false, status: 'pending' },
          ],
          approvalGates: [],
          tokenEstimate: {
            breakdown: [{ category: 'scenes', estimatedTokens: 50, variance: 10 }],
            totalEstimated: 50,
            totalVarianceHigh: 60,
            totalVarianceLow: 40,
            userTier: 'creator',
            sufficientBalance: true,
          },
          status: 'awaiting_approval',
          currentStepIndex: 0,
          createdAt: Date.now(),
        });
      }
    `);

    if (injected || isStrictMode) {
      const planTitle = await readStore<string>(
        page,
        '__EDITOR_STORE',
        `window.__EDITOR_STORE?.getState?.()?.currentPlan?.gdd?.title ?? null`,
      );
      expect(planTitle).toBe('E2E Platformer');

      const stepCount = await readStore<number>(
        page,
        '__EDITOR_STORE',
        `Object.keys(window.__EDITOR_STORE?.getState?.()?.stepStatuses ?? {}).length`,
      );
      expect(stepCount).toBe(2);
    }
  });

  // -------------------------------------------------------------------------
  // 4. Step status updates work correctly
  // -------------------------------------------------------------------------
  test('updateStepStatus changes individual step status', async ({ page, editor }) => {
    await editor.waitForEditorStore(E2E_TIMEOUT_LOAD_MS);

    // First set up a plan
    await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      const state = store?.getState?.();
      if (typeof state?.setPlan === 'function') {
        state.setPlan({
          id: 'e2e-plan-2',
          projectId: 'e2e-proj-2',
          prompt: 'test',
          gdd: { id: 'g2', title: 'Test', description: '', systems: [], scenes: [], assetManifest: [], estimatedScope: 'small', styleDirective: '', feelDirective: { mood: '', pacing: 'medium', weight: 'medium', referenceGames: [], oneLiner: '' }, constraints: [], projectType: '3d' },
          steps: [
            { id: 'step-a', executor: 'scene_create', input: {}, dependsOn: [], maxRetries: 1, optional: false, status: 'pending' },
          ],
          approvalGates: [],
          tokenEstimate: { breakdown: [], totalEstimated: 0, totalVarianceHigh: 0, totalVarianceLow: 0, userTier: 'starter', sufficientBalance: true },
          status: 'executing',
          currentStepIndex: 0,
          createdAt: Date.now(),
        });
      }
    `);

    // Update the step status
    const injected = await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      const state = store?.getState?.();
      if (typeof state?.updateStepStatus === 'function') {
        state.updateStepStatus('step-a', 'completed');
      }
    `);

    if (injected || isStrictMode) {
      const stepStatus = await readStore<string>(
        page,
        '__EDITOR_STORE',
        `window.__EDITOR_STORE?.getState?.()?.stepStatuses?.['step-a'] ?? null`,
      );
      expect(stepStatus).toBe('completed');
    }
  });

  // -------------------------------------------------------------------------
  // 5. Cancel pipeline works
  // -------------------------------------------------------------------------
  test('cancelPipeline sets status to cancelled', async ({ page, editor }) => {
    await editor.waitForEditorStore(E2E_TIMEOUT_LOAD_MS);

    await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      const state = store?.getState?.();
      if (typeof state?.setOrchestratorStatus === 'function') {
        state.setOrchestratorStatus('executing');
      }
    `);

    const injected = await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      const state = store?.getState?.();
      if (typeof state?.cancelPipeline === 'function') {
        state.cancelPipeline();
      }
    `);

    if (injected || isStrictMode) {
      const status = await readStore<string>(
        page,
        '__EDITOR_STORE',
        `window.__EDITOR_STORE?.getState?.()?.orchestratorStatus ?? null`,
      );
      expect(status).toBe('cancelled');
    }
  });

  // -------------------------------------------------------------------------
  // 6. Reset orchestrator returns to idle
  // -------------------------------------------------------------------------
  test('resetOrchestrator returns to idle state', async ({ page, editor }) => {
    await editor.waitForEditorStore(E2E_TIMEOUT_LOAD_MS);

    // Set a non-idle state first
    await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      const state = store?.getState?.();
      if (typeof state?.setOrchestratorStatus === 'function') {
        state.setOrchestratorStatus('completed');
      }
    `);

    const injected = await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      const state = store?.getState?.();
      if (typeof state?.resetOrchestrator === 'function') {
        state.resetOrchestrator();
      }
    `);

    if (injected || isStrictMode) {
      const status = await readStore<string>(
        page,
        '__EDITOR_STORE',
        `window.__EDITOR_STORE?.getState?.()?.orchestratorStatus ?? null`,
      );
      expect(status).toBe('idle');

      const plan = await readStore<unknown>(
        page,
        '__EDITOR_STORE',
        `window.__EDITOR_STORE?.getState?.()?.currentPlan ?? 'NULL'`,
      );
      expect(plan).toBe('NULL');
    }
  });

  // -------------------------------------------------------------------------
  // 7. Gate resolution flow
  // -------------------------------------------------------------------------
  test('resolveGate with approved clears pending gate', async ({ page, editor }) => {
    await editor.waitForEditorStore(E2E_TIMEOUT_LOAD_MS);

    // Set a pending gate
    await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      const state = store?.getState?.();
      if (typeof state?.setPendingGate === 'function') {
        state.setPendingGate({
          id: 'gate-1',
          label: 'Review Plan',
          description: 'Review before building',
          afterStepId: 's1',
          status: 'pending',
          displayData: {},
        });
      }
    `);

    // Resolve the gate
    const injected = await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      const state = store?.getState?.();
      if (typeof state?.resolveGate === 'function') {
        state.resolveGate('approved');
      }
    `);

    if (injected || isStrictMode) {
      const gate = await readStore<unknown>(
        page,
        '__EDITOR_STORE',
        `window.__EDITOR_STORE?.getState?.()?.pendingGate ?? 'NULL'`,
      );
      expect(gate).toBe('NULL');
    }
  });
});

// ---------------------------------------------------------------------------
// The journey gate: one prompt, driven through the real UI, to a playable scene.
//
// Everything above injects orchestrator state directly; this block injects
// NOTHING but the GDD the API would have returned. It clicks the toolbar entry,
// picks a game type, types a prompt, approves the gates that are not
// auto-approved, and presses Play — running the real `startQuickStart` ->
// `buildPlan` -> `runPipeline` path with the real executors.
// ---------------------------------------------------------------------------

/** The store surface this block reads. `__EDITOR_STORE` is declared `unknown`. */
interface JourneyState {
  orchestratorStatus: string;
  orchestratorError: string | null;
  currentPlan: { status: string } | null;
  stepStatuses: Record<string, string>;
  pendingGate: { id: string } | null;
  sceneGraph: { nodes: Record<string, unknown> };
}

/** One command the stand-in dispatcher was handed, in dispatch order. */
interface RecordedCommand {
  command: string;
  /**
   * Whether the entity this command names was already in the scene graph when
   * the command arrived. The engine flushes a spawn on a LATER frame, so a
   * command landing on an unflushed target is the PF-1213 silent-drop class.
   */
  targetFlushed: boolean;
}

/**
 * A run has to survive every step of a real plan (scene, world, entities,
 * physics, components, verification, polish), which is well past the config's
 * 45s per-test budget.
 */
const JOURNEY_RUN_TIMEOUT_MS = 120_000;

/** How long one leg of the run (start -> gate, gate -> gate, gate -> done) may take. */
const JOURNEY_PROGRESS_TIMEOUT_MS = 45_000;

/**
 * Bound on gate waits. `gate_plan` is auto-approved for quick-start, so a
 * healthy run stops at exactly two (`gate_assets`, `gate_final`) plus the
 * terminal read — anything more is a regression, and the bound is what turns
 * it into a failure instead of a hang.
 */
const MAX_GATE_WAITS = 5;

test.describe('Pipeline Game Creation Journey @journey', () => {
  test.beforeEach(async ({ page, editor }) => {
    // Routes must be registered BEFORE the first navigation.
    await page.route('**/api/game/decompose', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ gdd: crystalRun3dGdd }),
      }),
    );
    await page.route('**/api/game/pipeline', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        // `startDecomposition` throws unless this is a non-empty string. The
        // same route answers the fire-and-forget release on teardown.
        body: JSON.stringify({ reservationId: 'e2e-reservation' }),
      }),
    );
    // The quick-start path must never reach the chat route. Fail fast if it does
    // rather than hanging on a provider call.
    await page.route('**/api/chat', (route) => route.fulfill({ status: 503, body: '' }));

    await editor.loadPage();
  });

  test('a typed prompt builds a playable scene through the real pipeline', async ({
    page,
    editor,
  }) => {
    test.setTimeout(JOURNEY_RUN_TIMEOUT_MS);
    await editor.waitForEditorStore(E2E_TIMEOUT_LOAD_MS);

    // -----------------------------------------------------------------------
    // Install a recording stand-in for the engine dispatcher.
    //
    // This gate builds no WASM and Chromium runs with --disable-gpu, so
    // `init_engine` never completes and `getCommandDispatcher()` stays null —
    // `runPipelineFromPlan` refuses with 'Engine not loaded' before a single
    // step runs. `__FORGE_SET_DISPATCH` (EditorLayout, behind the same
    // build-time `e2eHooksEnabled()` gate as `__EDITOR_STORE`) hands the
    // stand-in to the production `setCommandDispatcher`, so it goes through the
    // same `tracked` wrapper and is wired into all 20 slices: this exercises the
    // real dispatch path, not a parallel one.
    //
    // SECURITY: the callback below is a compile-time function literal. No
    // fixture data, file content or other external input is interpolated into
    // it — see the note on `injectStore` in ../helpers/store-injection.
    // -----------------------------------------------------------------------
    const hooksInstalled = await page.evaluate(
      () => typeof window.__FORGE_SET_DISPATCH === 'function',
    );
    expect(
      hooksInstalled,
      'window.__FORGE_SET_DISPATCH is missing — build with NEXT_PUBLIC_E2E_HOOKS=true',
    ).toBe(true);

    await page.evaluate(() => {
      interface Recorded {
        command: string;
        targetFlushed: boolean;
      }
      interface SpawnedNode {
        entityId: string;
        name: string;
        parentId: string | null;
        children: string[];
        components: string[];
        visible: boolean;
      }

      const recorded: Recorded[] = [];
      (window as unknown as { __E2E_COMMANDS: Recorded[] }).__E2E_COMMANDS = recorded;

      const store = window.__EDITOR_STORE as {
        getState: () => {
          sceneGraph: { nodes: Record<string, unknown> };
          addNode: (node: SpawnedNode) => void;
        };
      };

      // A spawn is flushed on a LATER animation frame, never inside the dispatch
      // call. A fake that materializes the entity synchronously cannot fail on
      // the one ordering bug this gate exists to catch, and would read as
      // thorough coverage while proving nothing. `waitForEngineFrame` waits two
      // rAF ticks, so one tick of deferral is the faithful shape.
      const queued: SpawnedNode[] = [];
      let scheduled = false;
      const flush = () => {
        scheduled = false;
        const add = store.getState().addNode;
        let next = queued.shift();
        while (next) {
          add(next);
          next = queued.shift();
        }
      };

      window.__FORGE_SET_DISPATCH!((command: string, payload: unknown) => {
        const p = (payload ?? {}) as Record<string, unknown>;
        // `Object.hasOwn`, not a bare read: `p['constructor']` resolves on the
        // prototype chain and would report a phantom target.
        const target =
          Object.hasOwn(p, 'entityId') && typeof p.entityId === 'string' ? p.entityId : null;
        const nodes = store.getState().sceneGraph.nodes;
        recorded.push({
          command,
          targetFlushed: target === null ? true : Object.hasOwn(nodes, target),
        });

        if (command === 'spawn_entity') {
          const id =
            Object.hasOwn(p, 'id') && typeof p.id === 'string' && p.id.length > 0
              ? p.id
              : `engine-assigned-${recorded.length}`;
          const name = typeof p.name === 'string' ? p.name : 'Entity';
          queued.push({
            entityId: id,
            name,
            parentId: null,
            children: [],
            components: [],
            visible: true,
          });
          if (!scheduled) {
            scheduled = true;
            requestAnimationFrame(flush);
          }
        }

        return { success: true };
      });
    });

    // -----------------------------------------------------------------------
    // Drive the real UI.
    // -----------------------------------------------------------------------
    await page.getByTestId('quick-start-trigger').click();
    await page.getByRole('button', { name: 'Platformer' }).click();
    await page.locator('#quick-start-prompt').fill('collect every crystal to win');
    await page.getByRole('button', { name: 'Build it' }).click();

    // -----------------------------------------------------------------------
    // Approve the gates quick-start does NOT auto-approve, through the real
    // Approve button the dialog renders inline — the control that stops a
    // quick-start user being stranded mid-run. The locator is scoped to the
    // dialog because OrchestratorPanel renders a second ApprovalGateDialog with
    // an identically-named button, and the panel is open by this point.
    // -----------------------------------------------------------------------
    const terminalStatuses = ['completed', 'failed', 'cancelled'];
    const approvedGateIds: string[] = [];

    for (let i = 0; i < MAX_GATE_WAITS; i += 1) {
      const handle = await page.waitForFunction(
        (terminal: string[]) => {
          const state = (
            window.__EDITOR_STORE as
              | {
                  getState: () => {
                    pendingGate: { id: string } | null;
                    orchestratorStatus: string;
                  };
                }
              | undefined
          )?.getState();
          if (!state) return null;
          if (state.pendingGate) return { kind: 'gate', id: state.pendingGate.id };
          if (terminal.includes(state.orchestratorStatus)) {
            return { kind: 'done', id: state.orchestratorStatus };
          }
          return null;
        },
        terminalStatuses,
        { timeout: JOURNEY_PROGRESS_TIMEOUT_MS },
      );
      const outcome = (await handle.jsonValue()) as { kind: string; id: string };
      if (outcome.kind === 'done') break;

      approvedGateIds.push(outcome.id);
      await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
      // Wait for the gate to clear, or the next iteration re-reads the same one.
      await page.waitForFunction(
        () =>
          (
            window.__EDITOR_STORE as { getState: () => { pendingGate: unknown } } | undefined
          )?.getState().pendingGate === null,
        undefined,
        { timeout: E2E_TIMEOUT_LOAD_MS },
      );
    }

    // Exactly two: `gate_plan` is auto-approved for quick-start (a user who
    // typed a prompt has already approved the plan), the other two are not.
    expect(approvedGateIds).toEqual(['gate_assets', 'gate_final']);

    // -----------------------------------------------------------------------
    // Assert on store state only. `engineMode === 'play'` needs a live engine
    // and belongs to the engine-smoke gate (PF-1202), not here.
    // -----------------------------------------------------------------------
    const result = await page.evaluate(() => {
      const state = (window.__EDITOR_STORE as { getState: () => JourneyState }).getState();
      return {
        status: state.orchestratorStatus,
        error: state.orchestratorError,
        planStatus: state.currentPlan?.status ?? null,
        unfinishedSteps: Object.entries(state.stepStatuses)
          .filter(([, stepStatus]) => stepStatus !== 'completed')
          .map(([id, stepStatus]) => `${id}:${stepStatus}`),
        stepCount: Object.keys(state.stepStatuses).length,
        nodeCount: Object.keys(state.sceneGraph.nodes).length,
      };
    });

    expect(result.error).toBeNull();
    expect(result.status).toBe('completed');
    expect(result.planStatus).toBe('completed');
    expect(result.unfinishedSteps).toEqual([]);
    // A plan with no steps at all would satisfy the line above vacuously.
    expect(result.stepCount).toBeGreaterThan(5);
    expect(result.nodeCount).toBeGreaterThan(5);

    // -----------------------------------------------------------------------
    // Play. `gameSlice.play()` runs the winnability gate FIRST and returns
    // before dispatching anything when the scene can never be won — so a
    // recorded `play` command is the assertion that the generated game is
    // winnable, not merely that a button exists.
    // -----------------------------------------------------------------------
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await page.locator('button[aria-label="Play"]').click();

    const commands = await page.evaluate(
      () => (window as unknown as { __E2E_COMMANDS?: RecordedCommand[] }).__E2E_COMMANDS ?? [],
    );
    const names = commands.map((c) => c.command);

    expect(names).toContain('play');
    // The game was built through the engine, not written straight into the
    // store: a body for every spawned role, a camera the engine renders
    // through, and the win condition the winnability gate above depends on.
    expect(names).toContain('spawn_entity');
    expect(names).toContain('toggle_physics');
    expect(names).toContain('update_physics');
    expect(names).toContain('set_game_camera');
    expect(names).toContain('set_active_game_camera');
    expect(names).toContain('add_game_component');

    // A TRIPWIRE, NOT A REPRODUCTION — and measured as such.
    //
    // No command may name an entity the engine has not flushed yet (PF-1213).
    // Deleting `physicsEnableExecutor`'s pre-toggle `waitForEngineFrame` was
    // rebuilt and re-run against this spec and it still PASSED: `gate_assets`
    // is anchored to the last entity step and is NOT auto-approved, so a human
    // click separates every spawn from every later step and the scene graph is
    // always flushed by then. So this line does not cover the ordering class
    // today — it guards a future step that spawns after the last gate (only
    // `auto_polish`'s ground repair can, and only in a scene with no floor).
    // The live-engine gate (PF-1202) is what covers the real ordering.
    expect(commands.filter((c) => !c.targetFlushed).map((c) => c.command)).toEqual([]);
  });
});
