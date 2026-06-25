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

    // Step 3: enter Play mode — the engine snapshots state and inserts the
    // GameComponentRuntime. The Stop control appearing confirms play is active.
    const playBtn = page
      .locator('button[title*="Play"], button[title*="play"]')
      .first();
    await expect(playBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await playBtn.click();

    const stopBtn = page
      .locator('button[title*="Stop"], button[title*="stop"]')
      .first();
    await expect(stopBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // Step 4: stop — the engine restores the edit snapshot. Editor stays live.
    await stopBtn.click();
    await expect(page.locator('canvas').first()).toBeVisible();

    // Step 5: open the export dialog and confirm it renders export options.
    const exportBtn = page
      .locator('button')
      .filter({ hasText: /export/i })
      .first();
    await expect(exportBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await exportBtn.click();

    const dialog = page.locator(
      '[role="dialog"][aria-labelledby="settings-dialog-title"]'
    );
    await expect(dialog).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    const dialogText = await dialog.textContent();
    expect(dialogText).toBeTruthy();

    // Close the dialog; editor remains responsive.
    await page.keyboard.press('Escape');
    await expect(page.locator('canvas').first()).toBeVisible({
      timeout: E2E_TIMEOUT_SHORT_MS,
    });
  });
});
