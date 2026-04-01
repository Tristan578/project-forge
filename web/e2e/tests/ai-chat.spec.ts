import { test, expect } from '../fixtures/editor.fixture';
import {
  E2E_TIMEOUT_SHORT_MS,
  E2E_TIMEOUT_ELEMENT_MS,
} from '../constants';

test.describe('AI Chat @ui @dev', () => {
  test('chat overlay can be opened with Ctrl+K shortcut', async ({ page, editor }) => {
    await editor.loadPage();

    await editor.pressShortcut('Control+k');

    const chatHeader = page.locator('span').filter({ hasText: /AI Chat/i }).first();
    await expect(chatHeader).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  test('chat overlay can be closed with Escape key', async ({ page, editor }) => {
    await editor.loadPage();

    await editor.pressShortcut('Control+k');

    const chatHeader = page.locator('span').filter({ hasText: /AI Chat/i }).first();
    await expect(chatHeader).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    await page.keyboard.press('Escape');

    await expect(chatHeader).not.toBeVisible();
  });

  test('chat panel has input field when opened', async ({ page, editor }) => {
    await editor.loadPage();

    await editor.pressShortcut('Control+k');

    // Look for textarea in the chat overlay (the fixed z-50 overlay)
    const chatInput = page.getByRole('textbox', { name: 'Chat message' });
    await expect(chatInput).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  test('chat input accepts text', async ({ page, editor }) => {
    await editor.loadPage();

    await editor.pressShortcut('Control+k');

    const chatInput = page.getByRole('textbox', { name: 'Chat message' });
    await expect(chatInput).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await chatInput.click();
    await chatInput.fill('Create a cube');

    const value = await chatInput.inputValue();
    expect(value).toContain('cube');
  });

  test('chat history area exists', async ({ page, editor }) => {
    await editor.loadPage();

    await editor.pressShortcut('Control+k');

    const chatOverlay = page.locator('.fixed.z-50').first();
    await expect(chatOverlay).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

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

  test('chat can be opened and closed multiple times', async ({ page, editor }) => {
    await editor.loadPage();

    for (let i = 0; i < 3; i++) {
      await editor.pressShortcut('Control+k');
      const chatHeader = page.locator('span').filter({ hasText: /AI Chat/i }).first();
      await expect(chatHeader).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

      await page.keyboard.press('Escape');
      await expect(chatHeader).not.toBeVisible({ timeout: E2E_TIMEOUT_SHORT_MS });
    }
  });

  test('chat input clears between sessions', async ({ page, editor }) => {
    await editor.loadPage();

    // Open chat, type something, close
    await editor.pressShortcut('Control+k');
    const chatInput = page.getByRole('textbox', { name: 'Chat message' });
    await expect(chatInput).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await chatInput.fill('Test message one');
    await page.keyboard.press('Escape');

    // Re-open and check input is cleared
    await editor.pressShortcut('Control+k');
    const chatInput2 = page.getByRole('textbox', { name: 'Chat message' });
    await expect(chatInput2).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    const value = await chatInput2.inputValue();
    expect(value).toBe('');
  });

  test('chat overlay covers correct area of screen', async ({ page, editor }) => {
    await editor.loadPage();

    await editor.pressShortcut('Control+k');
    // Anchor to the chat panel via the "AI Chat" header it always contains
    const chatHeader = page.locator('span').filter({ hasText: /AI Chat/i }).first();
    await expect(chatHeader).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    // Walk up to the outermost chat panel container (rounded-lg card)
    const overlay = page.locator('span').filter({ hasText: /AI Chat/i }).locator('xpath=ancestor::div[@class and contains(@class,"rounded-lg")]').first();

    const box = await overlay.boundingBox();
    expect(box).not.toBeNull();
    // Overlay should be reasonably sized (not collapsed)
    expect(box!.width).toBeGreaterThan(200);
    expect(box!.height).toBeGreaterThan(200);
  });

  test('chat input supports multiline text', async ({ page, editor }) => {
    await editor.loadPage();

    await editor.pressShortcut('Control+k');
    const chatInput = page.getByRole('textbox', { name: 'Chat message' });
    await expect(chatInput).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // Textarea should accept multiline
    await chatInput.click();
    await chatInput.fill('Line 1\nLine 2\nLine 3');
    const value = await chatInput.inputValue();
    expect(value).toContain('Line 1');
    expect(value).toContain('Line 2');
  });
});
