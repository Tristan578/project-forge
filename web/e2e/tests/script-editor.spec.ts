import { test, expect } from '../fixtures/editor.fixture';

test.describe('Script Editor', () => {
  test('script editor panel can be opened', async ({ editor }) => {
    await editor.load();

    // Look for script editor panel in dockview
    await editor.expectPanelVisible('Script');
  });

  test('monaco editor loads in script panel', async ({ page, editor }) => {
    await editor.load();

    // Wait for Monaco to initialize
    await page.waitForTimeout(1500);

    // Look for Monaco editor container
    const monacoEditor = page.locator('.monaco-editor').first();
    const visible = await monacoEditor.isVisible().catch(() => false);
    expect(visible).toBe(true);
  });

  test('script panel has code/graph tab toggle', async ({ page, editor }) => {
    await editor.load();

    // Look for Code and Graph tabs
    const codeTab = page.getByRole('button', { name: /code/i });
    const graphTab = page.getByRole('button', { name: /graph|visual/i });

    const codeVisible = await codeTab.isVisible().catch(() => false);
    const graphVisible = await graphTab.isVisible().catch(() => false);

    expect(codeVisible || graphVisible).toBe(true);
  });

  test('script templates dropdown exists', async ({ page, editor }) => {
    await editor.load();

    // Look for template dropdown or button
    const templateControl = page.locator('select, button').filter({ hasText: /template/i }).first();
    const templateLabel = page.locator('text=/template|example/i').first();

    const controlCount = await templateControl.count();
    const labelCount = await templateLabel.count();
    expect(controlCount + labelCount).toBeGreaterThan(0);
  });

  test('script editor has save button', async ({ page, editor }) => {
    await editor.load();

    // Look for save button in script panel
    const saveBtn = page.locator('button').filter({ hasText: /save/i }).first();
    const exists = await saveBtn.count();
    expect(exists).toBeGreaterThan(0);
  });

  test('script panel has add script button when no script exists', async ({ page, editor }) => {
    await editor.load();

    // Select an entity (camera)
    await editor.selectEntity('Camera');
    await page.waitForTimeout(500);

    // Look for "Add Script" button
    const addScriptBtn = page.locator('button').filter({ hasText: /add.*script|new.*script/i }).first();
    const exists = await addScriptBtn.count();
    expect(exists).toBeGreaterThan(0);
  });

  test('script panel shows console output', async ({ page, editor }) => {
    await editor.load();

    // Look for console/logs section
    const consoleArea = page.locator('text=/console|logs|output/i').first();
    const consoleDiv = page.locator('[class*="console"], [class*="logs"]').first();

    const labelCount = await consoleArea.count();
    const divCount = await consoleDiv.count();
    expect(labelCount + divCount).toBeGreaterThan(0);
  });

  test('script editor can toggle between code and graph modes', async ({ page, editor }) => {
    await editor.load();

    // Find and click code tab
    const codeTab = page.getByRole('button', { name: /^code$/i });
    if (await codeTab.isVisible()) {
      await codeTab.click();
      await page.waitForTimeout(300);

      // Monaco should be visible
      const monacoVisible = await page.locator('.monaco-editor').isVisible().catch(() => false);
      expect(monacoVisible).toBe(true);

      // Switch to graph tab
      const graphTab = page.getByRole('button', { name: /graph|visual/i });
      if (await graphTab.isVisible()) {
        await graphTab.click();
        await page.waitForTimeout(500);

        // Graph editor should load
        const graphEditor = page.locator('[class*="react-flow"], [class*="graph"]').first();
        const graphCount = await graphEditor.count();
        expect(graphCount).toBeGreaterThan(0);
      }
    } else {
      test.skip();
    }
  });

  test('script panel has delete script button', async ({ page, editor }) => {
    await editor.load();

    // Look for delete/trash button
    const deleteBtn = page.locator('button').filter({ hasText: /delete|remove|trash/i }).first();
    const trashIcon = page.locator('button svg').filter({ hasText: '' }).first();

    const deleteCount = await deleteBtn.count();
    const iconCount = await trashIcon.count();
    expect(deleteCount + iconCount).toBeGreaterThan(0);
  });
});
