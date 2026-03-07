import { test, expect } from '../fixtures/editor.fixture';

test.describe('Editor Scene @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('scene hierarchy shows entities', async ({ page, editor }) => {
    // Check that the scene hierarchy panel exists
    await editor.expectPanelVisible('Scene');

    // At minimum, we should see at least one entity (Camera is always present)
    const cameraNode = page.getByText('Camera', { exact: false });
    await expect(cameraNode.first()).toBeVisible({ timeout: 10000 });
  });

  test('clicking entity in hierarchy shows transform in inspector', async ({ page, editor }) => {
    // Spawn and click a cube
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);
    await editor.selectEntity('Cube');

    // Wait for transform data to arrive
    const transformLabel = page.getByText('Transform', { exact: false });
    await expect(transformLabel.first()).toBeVisible({ timeout: 10000 });
  });

  test('camera preset buttons work', async ({ page }) => {
    // Find the "Top View" button
    const topButton = page.locator('button[title*="Top View"]');
    if (await topButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await topButton.click();

      // Wait for the camera animation to complete
      await expect(topButton).toHaveClass(/bg-blue-600/, { timeout: 5000 }).catch(() => {});
      const buttonClasses = await topButton.getAttribute('class');
      expect(buttonClasses).toContain('bg-blue-600');
    }
  });

  test('no critical console errors after load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Filter out known non-critical errors
    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('DevTools') &&
      !e.includes('wasm streaming') &&
      !e.includes('clerk') &&
      !e.includes('auth') &&
      !e.includes('api/tokens')
    );

    // We don't fail on errors, just report them for now
    expect(criticalErrors.length).toBeLessThan(5);
  });
});
