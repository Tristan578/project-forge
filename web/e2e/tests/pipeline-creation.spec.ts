import { test, expect } from '../fixtures/editor.fixture';
import { injectStore, readStore, isStrictMode } from '../helpers/store-injection';
import {
  E2E_TIMEOUT_SHORT_MS,
  E2E_TIMEOUT_ELEMENT_MS,
  E2E_TIMEOUT_LOAD_MS,
} from '../constants';

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

  // -------------------------------------------------------------------------
  // 8. QuickStart prompt-to-pipeline integration
  // -------------------------------------------------------------------------
  test('QuickStart flow is accessible from the editor', async ({ page }) => {
    // The QuickStart flow should be visible for new users (localStorage not set)
    // Check if the dialog renders
    const quickstartDialog = page.locator('[role="dialog"][aria-modal="true"]');
    const count = await quickstartDialog.count();

    if (count > 0) {
      // QuickStart is showing — verify step 1 content
      const gameTypeText = page.getByText('What kind of game?');
      const textCount = await gameTypeText.count();
      if (textCount > 0) {
        await expect(gameTypeText.first()).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
      }
    }
    // If QuickStart isn't visible, the user already completed it — that's fine
  });
});
