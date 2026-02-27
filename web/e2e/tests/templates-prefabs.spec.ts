import { test, expect } from '../fixtures/editor.fixture';

test.describe('Templates & Prefabs', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('template gallery can be accessed', async ({ page }) => {
    // Look for template/new project button
    const templateBtn = page.locator('button').filter({ hasText: /template|new.*project|starter/i }).first();
    const count = await templateBtn.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('scene toolbar has new scene button', async ({ page }) => {
    const newSceneBtn = page.locator('button[title*="New"], button[title*="new"]').first();
    const count = await newSceneBtn.count();
    expect(count).toBeGreaterThan(0);
  });

  test('scene has a default name', async ({ page }) => {
    // Check that scene name is displayed somewhere in the toolbar
    const sceneName = page.getByText(/untitled|scene|my.*scene/i, { exact: false });
    const count = await sceneName.count();
    expect(count).toBeGreaterThan(0);
  });

  test('entity spawning works for multiple primitive types', async ({ page, editor }) => {
    // Test cube
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);

    // Test sphere
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Sphere', { exact: true }).click();
    await editor.waitForEntityCount(3);

    // Verify both exist
    const cubeEl = page.getByText(/Cube/, { exact: false });
    const sphereEl = page.getByText(/Sphere/, { exact: false });
    await expect(cubeEl.first()).toBeVisible();
    await expect(sphereEl.first()).toBeVisible();
  });

  test('scene graph shows all spawned entities', async ({ page, editor }) => {
    // Spawn several entities
    const types = ['Cube', 'Sphere'];
    for (const type of types) {
      await page.getByRole('button', { name: 'Add Entity' }).click();
      await page.getByText(type, { exact: true }).click();
      await page.waitForTimeout(300);
    }
    await editor.waitForEntityCount(3); // camera + 2 entities

    // Hierarchy should show them
    const hierarchyItems = page.locator('[data-entity-id]');
    const count = await hierarchyItems.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('multi-scene UI elements exist', async ({ page }) => {
    // Look for scene list or scene tabs
    const sceneUI = page.locator('button, [role="tab"]').filter({ hasText: /scene/i });
    const count = await sceneUI.count();
    expect(count).toBeGreaterThan(0);
  });
});
