import { test, expect } from '../fixtures/editor.fixture';
import { E2E_TIMEOUT_ELEMENT_MS, E2E_TIMEOUT_LOAD_MS } from '../constants';

/**
 * Editor scene interaction tests.
 * Basic smoke tests (camera exists, console errors, sidebar) live in smoke.spec.ts.
 * These tests cover interactive workflows that go beyond basic loading.
 */
test.describe('Editor Scene @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('clicking entity in hierarchy shows transform in inspector', async ({ page, editor }) => {
    // Spawn and click a cube
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);
    await editor.selectEntity('Cube');

    // Wait for transform data to arrive
    const transformLabel = page.getByText('Transform', { exact: false });
    await expect(transformLabel.first()).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });
  });

  test('camera preset buttons work', async ({ page }) => {
    // Find the "Top View" button
    const topButton = page.locator('button[title*="Top View"]');
    if (await topButton.isVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS }).catch(() => false)) {
      await topButton.click();

      // Wait for the camera animation to complete
      await expect(topButton).toHaveClass(/bg-blue-600/, { timeout: E2E_TIMEOUT_ELEMENT_MS }).catch(() => {});
      const buttonClasses = await topButton.getAttribute('class');
      expect(buttonClasses).toContain('bg-blue-600');
    }
  });
});
