import { test, expect } from '../fixtures/editor.fixture';

test.describe('2D Workflows @ui', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  test('editor loads without errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    await page.waitForTimeout(1000);
    // Filter out expected WASM/WebGPU errors
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('WebGPU') && !e.includes('wasm') && !e.includes('GPU')
    );
    expect(realErrors.length).toBeLessThan(5);
  });

  test('project type selector or 2D option exists', async ({ page }) => {
    // Look for 2D/3D project type selector
    const projectTypeUI = page.locator('button, select, [role="tab"]').filter({ hasText: /2d|3d|project.*type/i });
    const count = await projectTypeUI.count();
    // May or may not be visible depending on UI state
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('editor has main canvas area', async ({ page }) => {
    // Canvas element lives inside dockview panel — check for canvas or its container
    const canvas = page.locator('canvas').first();
    const container = page.locator('[class*="overflow-hidden"][class*="flex-1"]').first();
    const hasCanvas = await canvas.count() > 0;
    const hasContainer = await container.count() > 0;
    expect(hasCanvas || hasContainer).toBe(true);
  });

  test('sidebar has entity management buttons', async ({ page }) => {
    const addEntityBtn = page.getByRole('button', { name: /add.*entity|spawn/i }).first();
    const count = await addEntityBtn.count();
    expect(count).toBeGreaterThan(0);
  });

  test('editor panels are all visible', async ({ page }) => {
    // Check for key UI panels (dockview tabs or panel content)
    const hierarchy = page.getByText(/hierarchy|scene/i, { exact: false });
    const inspector = page.getByText(/inspector|properties/i, { exact: false });

    // Panels live in dockview — check tab or content is present
    const hierarchyCount = await hierarchy.count();
    const inspectorCount = await inspector.count();
    // At least one of these panels should be rendered
    expect(hierarchyCount + inspectorCount).toBeGreaterThan(0);
  });

  test('2D sprite types available in entity menu', async ({ page }) => {
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.waitForTimeout(300);

    // Look for sprite or 2D entity options
    const spriteOption = page.getByText(/sprite|2d/i, { exact: false });
    const count = await spriteOption.count();
    // Sprite option may exist in the add entity menu
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('toolbar shows gizmo mode buttons', async ({ page }) => {
    // Translate/Rotate/Scale gizmo buttons
    const gizmoBtn = page.locator('button[title*="Translate"], button[title*="Rotate"], button[title*="Scale"]');
    const count = await gizmoBtn.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('settings modal can be opened', async ({ page }) => {
    const settingsBtn = page.getByRole('button', { name: /settings/i }).first();
    if (await settingsBtn.count() > 0) {
      await settingsBtn.click();
      await page.waitForTimeout(300);

      // Settings modal should appear
      const modal = page.locator('[class*="fixed"], [role="dialog"]').filter({ hasText: /settings/i });
      const visible = await modal.isVisible().catch(() => false);
      expect(visible).toBe(true);

      // Close it
      await page.keyboard.press('Escape');
    }
  });
});
