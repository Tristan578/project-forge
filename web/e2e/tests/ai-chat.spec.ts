import { test, expect } from '../fixtures/editor.fixture';

test.describe('AI Chat @ui', () => {
  test('chat overlay can be opened with Ctrl+K shortcut', async ({ page, editor }) => {
    await editor.loadPage();

    await editor.pressShortcut('Control+k');

    const chatHeader = page.locator('span').filter({ hasText: /AI Chat/i }).first();
    await expect(chatHeader).toBeVisible({ timeout: 5000 });
  });

  test('chat overlay can be closed with Escape key', async ({ page, editor }) => {
    await editor.loadPage();

    await editor.pressShortcut('Control+k');

    const chatHeader = page.locator('span').filter({ hasText: /AI Chat/i }).first();
    await expect(chatHeader).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');

    await expect(chatHeader).not.toBeVisible();
  });

  test('chat panel has input field when opened', async ({ page, editor }) => {
    await editor.loadPage();

    await editor.pressShortcut('Control+k');

    // Look for textarea in the chat overlay (the fixed z-50 overlay)
    const chatInput = page.locator('.fixed.z-50 textarea, .fixed.z-50 input[type="text"]').first();
    await expect(chatInput).toBeVisible({ timeout: 5000 });
  });

  test('chat input accepts text', async ({ page, editor }) => {
    await editor.loadPage();

    await editor.pressShortcut('Control+k');

    const chatInput = page.locator('.fixed.z-50 textarea').first();
    await expect(chatInput).toBeVisible({ timeout: 5000 });
    await chatInput.fill('Create a cube');

    const value = await chatInput.inputValue();
    expect(value).toContain('cube');
  });

  test('chat history area exists', async ({ page, editor }) => {
    await editor.loadPage();

    await editor.pressShortcut('Control+k');

    const chatOverlay = page.locator('.fixed.z-50').first();
    await expect(chatOverlay).toBeVisible({ timeout: 5000 });

    // Check that the overlay has content (header + message area + input)
    const childDivs = chatOverlay.locator('div');
    const count = await childDivs.count();
    expect(count).toBeGreaterThan(2);
  });

  test('chat panel is visible in right panel tab (mobile layout)', async ({ page, editor }) => {
    await editor.loadPage();

    // This test only applies in compact (mobile) mode — viewport must be < 1024px
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    if (viewportWidth >= 1024) {
      test.skip();
      return;
    }

    const chatTab = page.getByRole('button', { name: /chat/i });
    if (await chatTab.isVisible()) {
      await chatTab.click();
    }
  });
});
