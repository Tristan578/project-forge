import { test, expect } from '../fixtures/editor.fixture';

test.describe('Editor Smoke Tests', () => {
  test('page loads without console errors', async ({ page, editor }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await editor.load();

    // Allow a brief moment for any async errors to surface
    await page.waitForTimeout(1000);

    expect(consoleErrors).toHaveLength(0);
  });

  test('WASM engine initializes successfully', async ({ editor }) => {
    // load() internally waits for WASM initialization
    await editor.load();

    // If we reach here without timeout, WASM loaded successfully
    expect(true).toBe(true);
  });

  test('canvas renders with non-zero dimensions', async ({ editor }) => {
    await editor.load();

    const canvas = editor.canvas;
    const boundingBox = await canvas.boundingBox();

    expect(boundingBox).not.toBeNull();
    expect(boundingBox!.width).toBeGreaterThan(0);
    expect(boundingBox!.height).toBeGreaterThan(0);
  });

  test('default camera exists in scene hierarchy', async ({ page, editor }) => {
    await editor.load();

    // Wait for scene hierarchy to populate
    await page.waitForTimeout(500);

    // Check for Camera entity in the hierarchy
    const cameraElement = page.getByText('Camera', { exact: false });
    await expect(cameraElement.first()).toBeVisible();
  });

  test('sidebar is visible with interactive buttons', async ({ page, editor }) => {
    await editor.load();

    // Check that sidebar buttons are visible
    // Common sidebar buttons: Add Entity, Play/Pause controls, etc.
    const sidebar = page.locator('[class*="sidebar"]').first();
    await expect(sidebar).toBeVisible();

    // Check for at least one button in the sidebar
    const buttons = sidebar.locator('button');
    const buttonCount = await buttons.count();
    expect(buttonCount).toBeGreaterThan(0);
  });

  test('no JavaScript errors during initial load and interaction', async ({ page, editor }) => {
    const jsErrors: Error[] = [];

    page.on('pageerror', (error) => {
      jsErrors.push(error);
    });

    await editor.load();

    // Perform basic interaction
    await page.mouse.move(200, 200);
    await page.mouse.click(200, 200);

    // Wait for any delayed errors
    await page.waitForTimeout(500);

    expect(jsErrors).toHaveLength(0);
  });

  test('editor panels are accessible', async ({ page, editor }) => {
    await editor.load();

    // Wait for dockview layout to render
    await page.waitForTimeout(500);

    // Check that at least the scene hierarchy panel is visible
    await editor.expectPanelVisible('Scene');
  });
});
