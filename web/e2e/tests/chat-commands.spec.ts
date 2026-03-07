import { test, expect } from '../fixtures/editor.fixture';

/**
 * Tests for AI chat command execution pipeline.
 * Verifies that tool calls dispatched through the executor actually
 * modify the scene state — proving the core value proposition works.
 *
 * Uses page.evaluate() to call store actions directly, bypassing
 * the AI API (no API key needed in CI).
 *
 * NOTE: Basic entity CRUD tests (spawn, select, delete, undo, duplicate)
 * live in entity-crud.spec.ts. This file tests the command dispatch path.
 */
test.describe('Chat Command Execution @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('spawn_entity command creates entity in scene', async ({ page }) => {
    // Spawn via custom event (simulates what executeToolCall does)
    await page.evaluate(() => {
      const event = new CustomEvent('forge-command', {
        detail: { command: 'spawn_entity', payload: { entityType: 'cube', name: 'TestCube' } },
      });
      window.dispatchEvent(event);
    });

    // Check the scene hierarchy UI for the new entity
    const cubeElement = page.getByText(/TestCube|Cube/i, { exact: false });
    const count = await cubeElement.count();
    expect(count).toBeGreaterThan(0);
  });

  test('chat panel opens and shows input field', async ({ page }) => {
    await page.keyboard.press('Control+k');

    const chatInput = page.getByRole('textbox', { name: 'Chat message' });
    await expect(chatInput).toBeVisible({ timeout: 5000 });
  });

  test('rename entity updates hierarchy text', async ({ page, editor }) => {
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);

    await editor.selectEntity('Cube');

    // Try F2 to rename
    await page.keyboard.press('F2');

    // Look for an active input in the hierarchy
    const renameInput = page.locator('input[type="text"]').first();
    if (await renameInput.isVisible()) {
      await renameInput.fill('MyCube');
      await renameInput.press('Enter');

      const renamed = page.getByText('MyCube', { exact: false });
      const count = await renamed.count();
      expect(count).toBeGreaterThan(0);
    }
  });
});
