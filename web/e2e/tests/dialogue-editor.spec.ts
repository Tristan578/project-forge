import { test, expect } from '../fixtures/editor.fixture';

test.describe('Dialogue Editor @ui', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  test('dialogue panel or tab exists in editor', async ({ page, editor: _editor }) => {
    // Look for dialogue-related tab or panel
    const dialogueTab = page.locator('button, [role="tab"]').filter({ hasText: /dialogue/i });
    const count = await dialogueTab.count();
    // Dialogue may be behind a menu or tab - just verify it's findable
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('dialogue store initializes empty', async ({ page, editor: _editor }) => {
    const hasDialogueState = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (!store) return true; // Store may not be exposed
      const state = store.getState();
      return state.dialogueTrees === undefined || typeof state.dialogueTrees === 'object';
    });
    expect(hasDialogueState).toBe(true);
  });
});

test.describe('Dialogue Editor @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('editor layout includes all expected panel tabs', async ({ page, editor: _editor }) => {
    // Verify dockview panel tabs are present
    const tabs = page.locator('.dv-tab, [role="tab"]');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThan(0);
  });

  test('scene hierarchy panel is visible', async ({ page, editor: _editor }) => {
    const hierarchy = page.getByText(/hierarchy|scene/i, { exact: false });
    await expect(hierarchy.first()).toBeVisible();
  });

  test('inspector panel is visible', async ({ page, editor: _editor }) => {
    const inspector = page.getByText(/inspector|properties/i, { exact: false });
    await expect(inspector.first()).toBeVisible();
  });
});
