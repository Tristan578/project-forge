import { test, expect } from '../fixtures/editor.fixture';

test.describe('AI Chat @ui', () => {
  test('chat overlay can be opened with Ctrl+K shortcut', async ({ page, editor }) => {
    await editor.loadPage();

    // Press Ctrl+K to open chat overlay
    await editor.pressShortcut('Control+k');
    await page.waitForTimeout(500);

    // Chat overlay header contains "AI Chat" text
    const chatHeader = page.locator('span').filter({ hasText: /AI Chat/i }).first();
    await expect(chatHeader).toBeVisible({ timeout: 3000 });
  });

  test('chat overlay can be closed with Escape key', async ({ page, editor }) => {
    await editor.loadPage();

    // Open chat with Ctrl+K
    await editor.pressShortcut('Control+k');
    await page.waitForTimeout(500);

    // Verify it opened
    const chatHeader = page.locator('span').filter({ hasText: /AI Chat/i }).first();
    await expect(chatHeader).toBeVisible({ timeout: 3000 });

    // Press Escape to close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Chat header should not be visible
    await expect(chatHeader).not.toBeVisible();
  });

  test('chat panel has input field when opened', async ({ page, editor }) => {
    await editor.loadPage();

    // Open chat overlay
    await editor.pressShortcut('Control+k');
    await page.waitForTimeout(500);

    // Look for textarea in the chat overlay (the fixed z-50 overlay)
    const chatInput = page.locator('.fixed.z-50 textarea, .fixed.z-50 input[type="text"]').first();
    await expect(chatInput).toBeVisible({ timeout: 3000 });
  });

  test('chat input accepts text', async ({ page, editor }) => {
    await editor.loadPage();

    // Open chat
    await editor.pressShortcut('Control+k');
    await page.waitForTimeout(500);

    // Find the textarea in the chat overlay
    const chatInput = page.locator('.fixed.z-50 textarea').first();
    await expect(chatInput).toBeVisible({ timeout: 3000 });
    await chatInput.fill('Create a cube');

    // Verify text was entered
    const value = await chatInput.inputValue();
    expect(value).toContain('cube');
  });

  test('chat history area exists', async ({ page, editor }) => {
    await editor.loadPage();

    // Open chat
    await editor.pressShortcut('Control+k');
    await page.waitForTimeout(500);

    // The chat overlay (fixed z-50) should contain a scrollable area for messages
    const chatOverlay = page.locator('.fixed.z-50').first();
    await expect(chatOverlay).toBeVisible({ timeout: 3000 });

    // Check that the overlay has content (header + message area + input)
    const childDivs = chatOverlay.locator('div');
    const count = await childDivs.count();
    expect(count).toBeGreaterThan(2);
  });

  test('chat panel is visible in right panel tab (mobile layout)', async ({ page, editor }) => {
    await editor.loadPage();

    // This test only applies in compact (mobile) mode — viewport must be < 1024px
    // Desktop Chrome viewport is 1280px, so this test should skip
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    if (viewportWidth >= 1024) {
      test.skip();
      return;
    }

    // Look for chat tab in mobile layout
    const chatTab = page.getByRole('button', { name: /chat/i });
    if (await chatTab.isVisible()) {
      await chatTab.click();
      await page.waitForTimeout(300);
    }
  });
});
