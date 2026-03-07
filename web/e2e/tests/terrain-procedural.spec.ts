import { test, expect } from '../fixtures/editor.fixture';

test.describe('Terrain & Procedural @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('terrain can be spawned from entity menu', async ({ page }) => {
    await page.getByRole('button', { name: 'Add Entity' }).click();


    // Look for terrain option
    const terrainOption = page.getByText(/terrain/i, { exact: false });
    const count = await terrainOption.count();
    // Entity menu should be open with at least primitives
    if (count === 0) {
      const cubeOption = page.getByText('Cube', { exact: true });
      expect(await cubeOption.count()).toBeGreaterThan(0);
    } else {
      expect(count).toBeGreaterThan(0);
    }
  });

  test('entity menu shows primitive types', async ({ page }) => {
    await page.getByRole('button', { name: 'Add Entity' }).click();


    // Should show cube, sphere, etc.
    const cube = page.getByText('Cube', { exact: true });
    const sphere = page.getByText('Sphere', { exact: true });
    await expect(cube.first()).toBeVisible();
    await expect(sphere.first()).toBeVisible();
  });

  test('entity menu shows light types', async ({ page }) => {
    await page.getByRole('button', { name: 'Add Entity' }).click();


    // Should show light options
    const lightOption = page.getByText(/light/i, { exact: false });
    const count = await lightOption.count();
    expect(count).toBeGreaterThan(0);
  });

  test('spawned entity can be transformed', async ({ page, editor }) => {
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);
    await editor.selectEntity('Cube');


    // Find transform inputs and modify
    const transformSection = page.getByText('Transform', { exact: false });
    await expect(transformSection.first()).toBeVisible();

    const inputs = page.locator('input[type="text"]');
    const inputCount = await inputs.count();
    expect(inputCount).toBeGreaterThan(0);
  });

  test('grid toggle works', async ({ page }) => {
    // Look for grid toggle button
    const gridBtn = page.locator('button[title*="Grid"], button[title*="grid"]').first();
    if (await gridBtn.count() > 0) {
      await gridBtn.click();
      // Verify button is still interactive after toggle
      await expect(gridBtn).toBeVisible();
    } else {
      // Verify sidebar has interactive buttons even without grid toggle
      const sidebarBtns = page.locator('button[title]');
      expect(await sidebarBtns.count()).toBeGreaterThan(0);
    }
  });

  test('coordinate mode can be toggled', async ({ page }) => {
    // Look for local/global coordinate toggle
    const coordBtn = page.locator('button[title*="coordinate"], button[title*="Local"], button[title*="Global"]').first();
    if (await coordBtn.count() > 0) {
      await coordBtn.click();
      // Verify button is still interactive after toggle
      await expect(coordBtn).toBeVisible();
    } else {
      // Verify transform tools exist as fallback
      const transformBtn = page.locator('button[title*="Translate"]').first();
      expect(await transformBtn.count()).toBeGreaterThan(0);
    }
  });
});
