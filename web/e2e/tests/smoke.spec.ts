import { test, expect } from '../fixtures/editor.fixture';

test.describe('Editor Smoke Tests @engine', () => {
  test('page loads without console errors', async ({ page, editor }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await editor.load();

    // Allow a brief moment for any async errors to surface


    expect(consoleErrors).toHaveLength(0);
  });

  test('WASM engine initializes successfully', async ({ editor }) => {
    // load() internally waits for WASM initialization
    await editor.load();

    // WASM loaded successfully — verify canvas is present and has dimensions
    const box = await editor.canvas.boundingBox();
    expect(box).not.toBeNull();
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

    // Check for Camera entity in the hierarchy
    const cameraElement = page.getByText('Camera', { exact: false });
    await expect(cameraElement.first()).toBeVisible({ timeout: 10000 });
  });

  test('sidebar is visible with interactive buttons', async ({ page, editor }) => {
    await editor.load();

    // Check that sidebar buttons are visible
    // Common sidebar buttons: Add Entity, Play/Pause controls, etc.
    const sidebar = page.locator('[class*="sidebar"]').first();
    await expect(sidebar).toBeVisible();

    // Check for at least one button in the sidebar
    const buttons = sidebar.locator('button');
    await expect(buttons.first()).toBeVisible();
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

    expect(jsErrors).toHaveLength(0);
  });

  test('editor panels are accessible', async ({ editor }) => {
    await editor.load();

    // Check that at least the scene hierarchy panel is visible
    await editor.expectPanelVisible('Scene');
  });
});
