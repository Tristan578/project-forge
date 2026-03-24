import { test, expect } from '../fixtures/editor.fixture';

/**
 * PF-691 / PF-863: Visual-consistency tests.
 *
 * These tests verify that the editor UI is structurally present and has the
 * expected visual properties (colours, layout containers, ARIA roles) after a
 * full page load.  They do NOT rely on pixel-level screenshot snapshots because
 * those require committed baseline images and cannot run in a clean CI
 * environment without a GPU.
 *
 * Tagged @ui so they run in the UI shard without WASM.
 */

test.describe('Visual Consistency @ui', () => {
  test('editor root container is rendered and visible', async ({ page, editor }) => {
    await editor.loadPage();
    const container = page.locator('.dv-dockview-container').first();
    await expect(container).toBeVisible({ timeout: 10_000 });
  });

  test('page body uses the expected dark background colour', async ({ page, editor }) => {
    await editor.loadPage();
    const bgColor = await page.evaluate(
      () => window.getComputedStyle(document.body).backgroundColor,
    );
    // The editor uses zinc-950 (#09090b) or a close dark equivalent.
    // We verify it is not white or transparent to catch accidental theme regressions.
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(bgColor).not.toBe('rgb(255, 255, 255)');
  });

  test('no text is rendered with zero-opacity colour', async ({ editor }) => {
    await editor.loadPage();
    await editor.assertNoInvisibleElements();
  });

  test('at least one dockview tab is visible', async ({ page, editor }) => {
    await editor.loadPage();
    const tabs = page.locator('.dv-tab');
    await expect(tabs.first()).toBeVisible({ timeout: 10_000 });
  });

  test('chat panel or sidebar is present in the layout', async ({ page, editor }) => {
    await editor.loadPage();
    // The chat / AI panel is always mounted — it is the AI input surface.
    const chatInput = page.locator(
      '[data-testid="chat-input"], [placeholder*="Ask"], [aria-label*="chat"], [aria-label*="AI"]',
    );
    const sidebar = page.locator('aside, [data-testid="sidebar"]');

    const chatVisible = await chatInput.first().isVisible().catch(() => false);
    const sidebarVisible = await sidebar.first().isVisible().catch(() => false);
    expect(chatVisible || sidebarVisible).toBe(true);
  });

  test('page title is set to the expected product name', async ({ page, editor }) => {
    await editor.loadPage();
    const title = await page.title();
    // Title should contain the product name (case-insensitive).
    expect(title.toLowerCase()).toMatch(/spawnforge|forge/);
  });
});
