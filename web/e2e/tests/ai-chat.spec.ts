import { test, expect } from '../fixtures/editor.fixture';

test.describe('AI Chat', () => {
  test('chat overlay can be opened with Ctrl+K shortcut', async ({ page, editor }) => {
    await editor.loadPage();

    // Press Ctrl+K to open chat overlay
    await editor.pressShortcut('Control+k');
    await page.waitForTimeout(300);

    // Chat overlay should be visible
    const chatOverlay = page.locator('[class*="chat"]').filter({ hasText: /AI|Chat/i }).first();
    await expect(chatOverlay).toBeVisible();
  });

  test('chat overlay can be closed with Escape key', async ({ page, editor }) => {
    await editor.loadPage();

    // Open chat with Ctrl+K
    await editor.pressShortcut('Control+k');
    await page.waitForTimeout(300);

    // Press Escape to close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Chat overlay should not be visible (or minimal UI remains)
    const chatInput = page.locator('textarea, input').filter({ hasText: /ask|chat/i }).first();
    const isVisible = await chatInput.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test('chat panel has input field when opened', async ({ page, editor }) => {
    await editor.loadPage();

    // Open chat overlay
    await editor.pressShortcut('Control+k');
    await page.waitForTimeout(300);

    // Look for textarea or input in chat area
    const chatInput = page.locator('textarea[placeholder*="Ask"], textarea[placeholder*="chat" i], input[placeholder*="Ask"], input[placeholder*="chat" i]').first();
    await expect(chatInput).toBeVisible({ timeout: 2000 });
  });

  test('chat input accepts text', async ({ page, editor }) => {
    await editor.loadPage();

    // Open chat
    await editor.pressShortcut('Control+k');
    await page.waitForTimeout(300);

    // Find input and type
    const chatInput = page.locator('textarea, input').filter({ hasText: '' }).first();
    await chatInput.fill('Create a cube');

    // Verify text was entered
    const value = await chatInput.inputValue();
    expect(value).toContain('cube');
  });

  test('chat history area exists', async ({ page, editor }) => {
    await editor.loadPage();

    // Open chat
    await editor.pressShortcut('Control+k');
    await page.waitForTimeout(300);

    // Look for messages container or chat history
    const messagesArea = page.locator('[class*="messages"], [class*="history"], [class*="conversation"]').first();
    const exists = await messagesArea.count();
    expect(exists).toBeGreaterThan(0);
  });

  test('chat panel is visible in right panel tab (mobile layout)', async ({ page, editor }) => {
    await editor.loadPage();

    // Look for chat tab in mobile layout (if exists)
    const chatTab = page.getByRole('button', { name: /chat/i });
    if (await chatTab.isVisible()) {
      await chatTab.click();
      await page.waitForTimeout(300);

      // Chat content should be visible
      const chatContent = page.locator('[class*="chat"]');
      await expect(chatContent.first()).toBeVisible();
    } else {
      // Skip if not in mobile layout
      test.skip();
    }
  });
});
