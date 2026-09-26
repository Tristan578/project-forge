import { test, expect } from '../fixtures/editor.fixture';
import type { useEditorStore } from '../../src/stores/editorStore';

type TestWindow = Window & { __EDITOR_STORE: typeof useEditorStore };

test.describe('Completion mode controls @ui @dev', () => {
  test('keyboard selection, undo and redo follow the same scene state', async ({ page, editor }) => {
    await editor.loadPage();
    const win = page.getByRole('radio', { name: 'Win', exact: true });
    await expect(win).toBeVisible();
    await win.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Endless', exact: true })).toBeChecked();
    await page.keyboard.press('ArrowRight');
    const sandbox = page.getByRole('radio', { name: 'Sandbox', exact: true });
    await expect(sandbox).toBeFocused();
    await expect(sandbox).toBeChecked();
    expect(await sandbox.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth))).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as TestWindow).__EDITOR_STORE.getState().sceneGraph.completionMode)).toBe('sandbox');
    const undo = page.getByRole('button', { name: 'Undo completion mode change' });
    await undo.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('radio', { name: 'Endless', exact: true })).toBeChecked();
    const redo = page.getByRole('button', { name: 'Redo completion mode change' });
    await redo.focus();
    await page.keyboard.press('Enter');
    await expect(sandbox).toBeChecked();
    await page.evaluate(() => (window as TestWindow).__EDITOR_STORE.getState().setCompletionMode('narrative'));
    await expect(page.getByRole('radio', { name: 'Narrative', exact: true })).toBeChecked();
    const section = page.getByRole('radiogroup', { name: 'Completion mode' }).locator('..');
    await expect(section.getByRole('status')).toBeEmpty();
  });

  test('mobile options and history buttons have full touch targets', async ({ page, editor }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await editor.loadPage();
    await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    const group = page.getByRole('radiogroup', { name: 'Completion mode' });
    await expect(group).toBeVisible();
    for (const radio of await group.getByRole('radio').all()) {
      const box = await radio.locator('..').boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    // The description is part of the native label, not merely decorative text.
    await group.getByText('A toy or creative space with no goal. Play does not require a win condition.', { exact: true }).click();
    await expect(group.getByRole('radio', { name: 'Sandbox', exact: true })).toBeChecked();
    for (const name of ['Undo completion mode change', 'Redo completion mode change']) {
      const box = await page.getByRole('button', { name }).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  });
});
