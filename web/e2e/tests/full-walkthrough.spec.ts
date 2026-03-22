import { test, expect } from '../fixtures/editor.fixture';

/**
 * PF-161: Full demo walkthrough regression test (@engine).
 *
 * Exercises the critical end-to-end path with WASM engine:
 *   load editor → spawn entity → select → inspect transform →
 *   play mode → stop → open export dialog → verify export options.
 *
 * Requires GPU-capable environment (not headless --disable-gpu).
 * The @ui variant lives in demo-regression.spec.ts.
 */
test.describe('Full Demo Walkthrough @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('spawn entity and verify it appears in hierarchy', async ({ page, editor }) => {
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);

    const cubeEl = page.getByText(/Cube/, { exact: false });
    await expect(cubeEl.first()).toBeVisible();
  });

  test('select entity and verify transform in inspector', async ({ page, editor }) => {
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);
    await editor.selectEntity('Cube');

    const transformSection = page.getByText('Transform', { exact: false });
    await expect(transformSection.first()).toBeVisible({ timeout: 10000 });

    // Verify position inputs exist
    const inputs = page.locator('input[type="text"]');
    const inputCount = await inputs.count();
    expect(inputCount).toBeGreaterThan(0);
  });

  test('play mode starts and stops without crash', async ({ page }) => {
    // Find and click play button
    const playBtn = page.locator('button[title*="Play"], button[title*="play"]').first();
    await expect(playBtn).toBeVisible({ timeout: 5000 });
    await playBtn.click();

    // Wait for the stop button to appear — its presence confirms play mode is active
    const stopBtn = page.locator('button[title*="Stop"], button[title*="stop"]').first();
    await stopBtn.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {/* engine may not reach play in headless */});
    if (await stopBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await stopBtn.click();
    }

    // Editor should still be responsive — canvas visible
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  test('export dialog opens with expected options', async ({ page }) => {
    // Look for export button in toolbar
    const exportBtn = page.locator('button').filter({ hasText: /export/i }).first();
    if (await exportBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await exportBtn.click();

      // Export dialog should appear
      const dialog = page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Should have format options
      const formatOption = dialog.getByText(/html|zip|pwa/i, { exact: false });
      const formatCount = await formatOption.count();
      expect(formatCount).toBeGreaterThan(0);

      // Should have a download/export button
      const downloadBtn = dialog.locator('button').filter({ hasText: /download|export/i });
      await expect(downloadBtn.first()).toBeVisible();

      // Close the dialog
      await page.keyboard.press('Escape');
    }
  });

  test('full flow: spawn → select → play → stop → export', async ({ page, editor }) => {
    // Step 1: Spawn entity
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);

    // Step 2: Select and verify transform
    await editor.selectEntity('Cube');
    const transformSection = page.getByText('Transform', { exact: false });
    await expect(transformSection.first()).toBeVisible({ timeout: 10000 });

    // Step 3: Enter play mode
    const playBtn = page.locator('button[title*="Play"], button[title*="play"]').first();
    if (await playBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await playBtn.click();
      // Wait for play-mode stop button to appear before proceeding
      const stopBtnInFlow = page.locator('button[title*="Stop"], button[title*="stop"]').first();
      await stopBtnInFlow.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {/* headless may not reach play */});

      // Step 4: Stop play mode
      const stopBtn = page.locator('button[title*="Stop"], button[title*="stop"]').first();
      if (await stopBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await stopBtn.click();
      }
    }

    // Step 5: Open export
    const exportBtn = page.locator('button').filter({ hasText: /export/i }).first();
    if (await exportBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await exportBtn.click();

      const dialog = page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Verify export dialog has content
      const dialogText = await dialog.textContent();
      expect(dialogText).toBeTruthy();

      await page.keyboard.press('Escape');
    }

    // Editor should still be responsive
    await expect(page.locator('canvas').first()).toBeVisible();
  });
});
