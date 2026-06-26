import { test, expect } from '../fixtures/editor.fixture';
import {
  E2E_TIMEOUT_SHORT_MS,
  E2E_TIMEOUT_ELEMENT_MS,
  E2E_TIMEOUT_LOAD_MS,
} from '../constants';

/**
 * #8602 (F10): curated per-PR @engine-smoke journey.
 *
 * This is the SINGLE spec run by the test-e2e-engine-smoke CI job
 * (playwright.engine.config.ts) — the first per-PR job that actually boots the
 * WASM engine, under ANGLE/SwiftShader software WebGL2 (NOT --disable-gpu, which
 * leaves wgpu with no GL context and hangs `init_engine`).
 *
 * It exercises the critical end-to-end editor path through the REAL engine:
 *   load editor (WASM + Bevy init) -> spawn entity -> select + inspect transform
 *   -> Play -> Stop -> open export dialog.
 *
 * The broader full-walkthrough.spec.ts (@engine, 5 tests) covers the same path
 * but is NOT a curated subset; tagging this narrow flow with the distinct
 * `@engine-smoke` tag keeps the per-PR SwiftShader run small and fast (software
 * rendering is slow — a large @engine sweep would blow the job timeout). The
 * full @engine sweep remains available for a GPU-capable / nightly runner.
 *
 * DOCUMENTED GAP: SwiftShader is software WebGL2 — this validates ECS / picking
 * / play / export journeys but NOT WebGPU or real-GPU rendering correctness.
 */
test.describe('Engine Smoke Journey @engine @engine-smoke', () => {
  test.beforeEach(async ({ page, editor }) => {
    // Force the WebGL2 backend BEFORE the app loads so loadWasm() (useEngine.ts)
    // never probes WebGPU (SwiftShader cannot drive it) and never spends
    // GPU_INIT_TIMEOUT before falling back. This uses the same persisted
    // preference key the in-app WebGL2 fallback button writes
    // (PREFERRED_BACKEND_KEY = 'forge:preferred-backend'); we set it via the
    // app's own mechanism rather than editing production code.
    await page.addInitScript(() => {
      localStorage.setItem('forge:preferred-backend', 'webgl2');
    });
    await editor.load();
  });

  test('full engine journey: load -> spawn -> inspect -> play -> stop -> export', async ({
    page,
    editor,
  }) => {
    // Step 0: load() already proved the engine reached __FORGE_ENGINE_READY and
    // the editor layout (.dv-dockview) is visible. The canvas must be present.
    await expect(page.locator('canvas').first()).toBeVisible({
      timeout: E2E_TIMEOUT_ELEMENT_MS,
    });

    // Step 1: spawn a Cube via the Add Entity menu and confirm it lands in the
    // scene graph (entity count grows past the default camera-only scene).
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);
    await expect(page.getByText(/Cube/, { exact: false }).first()).toBeVisible();

    // Step 2: select the entity and confirm the inspector shows its transform.
    await editor.selectEntity('Cube');
    await expect(page.getByText('Transform', { exact: false }).first()).toBeVisible({
      timeout: E2E_TIMEOUT_LOAD_MS,
    });
    const positionInputs = page.locator('input[type="text"]');
    expect(await positionInputs.count()).toBeGreaterThan(0);

    // Step 2b: satisfy the pre-play winnability gate (#8542) so Play can actually
    // enter play mode. play() (gameSlice) runs validateWinnability BEFORE
    // dispatching to the engine: a scene with no win condition can never be won,
    // so the gate surfaces a message and RETURNS — leaving engineMode 'edit' and
    // the Pause/Stop buttons disabled. A bare Cube is exactly that scene, so
    // without this the Step-3 transition below never fires. Attach a minimal,
    // genuinely-winnable condition — a `score` target > 0 needs no player or
    // collectibles (winnabilityValidator.ts evaluateCondition 'score') — via the
    // SAME store action the Game inspector calls (addGameComponent writes
    // allGameComponents, which is exactly what the gate's reader inspects). This
    // makes the gate pass on real state, so Step 3 exercises the genuine
    // Edit -> Play engine transition rather than being silently short-circuited.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      const state = store.getState();
      const targetId: string | undefined =
        state.primaryId ?? Object.keys(state.sceneGraph?.nodes ?? {})[0];
      if (!targetId) {
        throw new Error('engine-smoke: no entity to attach a win condition to');
      }
      state.addGameComponent(targetId, {
        type: 'winCondition',
        winCondition: {
          conditionType: 'score',
          targetScore: 100,
          targetEntityId: null,
        },
      });
    });

    // Step 3: enter Play mode — the engine snapshots state and inserts the
    // GameComponentRuntime. The Stop button is ALWAYS rendered (PlayControls.tsx
    // only toggles its `disabled` attribute), so its visibility proves nothing
    // about the mode. The mode-SENSITIVE signal is the `role="status"` indicator
    // span, which PlayControls renders ONLY when `!isEdit` with the text
    // 'Playing'/'Paused'. Assert it is absent in edit mode and appears after Play,
    // and cross-check the store's `engineMode` transitions 'edit' -> 'play'.
    const playStatus = page.getByRole('status').filter({ hasText: 'Playing' });
    await expect(playStatus).toHaveCount(0);
    expect(
      await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        return store?.getState().engineMode;
      })
    ).toBe('edit');

    const playBtn = page
      .locator('button[title*="Play"], button[title*="play"]')
      .first();
    await expect(playBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await playBtn.click();

    // The 'Playing' indicator span becoming visible is true ONLY in play mode.
    await expect(playStatus).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await page.waitForFunction(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        return store?.getState().engineMode === 'play';
      },
      { timeout: E2E_TIMEOUT_ELEMENT_MS }
    );

    // Step 4: stop — the engine restores the edit snapshot and PlayControls drops
    // the indicator span (back to edit mode). Editor stays live.
    const stopBtn = page
      .locator('button[title*="Stop"], button[title*="stop"]')
      .first();
    await expect(stopBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await stopBtn.click();
    await expect(playStatus).toHaveCount(0);
    await page.waitForFunction(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        return store?.getState().engineMode === 'edit';
      },
      { timeout: E2E_TIMEOUT_ELEMENT_MS }
    );
    await expect(page.locator('canvas').first()).toBeVisible();

    // Step 5: open the export dialog and confirm it renders export options.
    // The toolbar Export button (SceneToolbar.tsx) is icon-only (Download icon,
    // aria-label="Export game", no text node) so it must be located by its
    // accessible name, not hasText.
    const exportBtn = page.getByRole('button', { name: 'Export game' });
    await expect(exportBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await exportBtn.click();

    // The Export dialog (ExportDialog.tsx) labels itself with
    // aria-labelledby="export-dialog-title" (settings-dialog-title belongs to a
    // different panel).
    const dialog = page.locator(
      '[role="dialog"][aria-labelledby="export-dialog-title"]'
    );
    await expect(dialog).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    // Assert on REAL, known export options rendered by ExportDialog.tsx — not a
    // shape-only "non-empty" check. The "Export Mode" section lists concrete
    // format labels; "Single HTML File" is the default-selected radio and
    // "ZIP Bundle" / "Embed (iframe)" are sibling format options. Their presence
    // proves the export options actually rendered.
    await expect(
      dialog.getByText('Export Mode', { exact: false })
    ).toBeVisible();
    await expect(
      dialog.getByText('Single HTML File', { exact: true })
    ).toBeVisible();
    await expect(
      dialog.getByText('Embed (iframe)', { exact: true })
    ).toBeVisible();

    // Close the dialog; editor remains responsive.
    await page.keyboard.press('Escape');
    await expect(page.locator('canvas').first()).toBeVisible({
      timeout: E2E_TIMEOUT_SHORT_MS,
    });
  });
});
