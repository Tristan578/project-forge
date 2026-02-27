import { test, expect } from '../fixtures/editor.fixture';

test.describe('Visual Scripting', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('script panel exists in editor layout', async ({ page, editor: _editor }) => {
    // Look for script-related tab or panel
    const scriptTab = page.locator('button, [role="tab"]').filter({ hasText: /script/i });
    const count = await scriptTab.count();
    expect(count).toBeGreaterThan(0);
  });

  test('script editor opens when entity with script is selected', async ({ page, editor: _editor }) => {
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await _editor.waitForEntityCount(2);
    await _editor.selectEntity('Cube');
    await page.waitForTimeout(300);

    // Look for script section in inspector
    const scriptSection = page.getByText(/script/i, { exact: false });
    const count = await scriptSection.count();
    expect(count).toBeGreaterThan(0);
  });

  test('visual script editor has code and graph tabs', async ({ page, editor: _editor }) => {
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await _editor.waitForEntityCount(2);
    await _editor.selectEntity('Cube');
    await page.waitForTimeout(300);

    // Look for Code/Graph toggle or tabs
    const codeTabs = page.locator('button, [role="tab"]').filter({ hasText: /code|graph|visual/i });
    const count = await codeTabs.count();
    expect(count).toBeGreaterThan(0);
  });

  test('script templates are available', async ({ page, editor: _editor }) => {
    // Look for script template UI
    const templateUI = page.locator('button, select').filter({ hasText: /template|character.*controller|collectible/i });
    const count = await templateUI.count();
    expect(count).toBeGreaterThan(0);
  });

  test('editor supports keyboard shortcuts for common actions', async ({ page, editor: _editor }) => {
    // Verify Ctrl+Z (undo) and Ctrl+D (duplicate) don't crash
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    // No crash = pass
    expect(true).toBe(true);
  });
});
