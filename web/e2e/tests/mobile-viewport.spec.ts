import { test, expect } from '../fixtures/editor.fixture';
import { E2E_TIMEOUT_ELEMENT_MS, E2E_TIMEOUT_LOAD_MS } from '../constants';

/**
 * PF-673: Mobile viewport E2E tests.
 *
 * Tests the editor at iPhone 14 (390x844) and Pixel 7 (412x915) viewports.
 * Verifies compact layout: mobile toolbar visibility, sidebar collapse,
 * and canvas taking full width.
 *
 * All tests tagged @ui — no WASM engine required.
 * Desktop Chromium only, using mobile emulation (not real devices).
 */

/**
 * PF-1017: the editor must clip to the viewport rather than grow a document
 * scrollbar.
 *
 * `<ViewportLock>` uses `h-dvh`, not `h-screen`, because `100vh` resolves to the
 * LARGE viewport on mobile browsers (URL bar retracted) — a `100vh` box in
 * normal flow overflows the visual viewport by the browser-chrome height and
 * makes the whole editor document-scrollable. A global `body { overflow: hidden }`
 * used to mask that; it was removed because it killed scrolling on every public
 * page, so nothing masks it now.
 *
 * Caveat, deliberately not oversold: Chromium's device emulation has no
 * retracting URL bar, so `innerHeight` here already IS the large viewport and
 * this cannot reproduce the mobile-Safari case. It is a real tripwire for the
 * general "editor grew a document scrollbar" regression, which is strictly more
 * than the zero coverage that existed before.
 */
async function expectViewportContained(page: import('@playwright/test').Page) {
  const { scrollHeight, clientHeight } = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  // 1px tolerance for sub-pixel layout rounding.
  expect(scrollHeight, 'editor overflowed the viewport vertically').toBeLessThanOrEqual(
    clientHeight + 1
  );
}

// ---------------------------------------------------------------------------
// iPhone 14 (390x844)
// ---------------------------------------------------------------------------
test.describe('iPhone 14 Viewport (390x844) @ui @dev', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  test('page loads at iPhone 14 resolution', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).toBeVisible();
    const box = await body.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(390);
  });

  test('editor does not become document-scrollable', async ({ page }) => {
    await expectViewportContained(page);
  });

  test('mobile toolbar appears in compact layout', async ({ page }) => {
    // The mobile toolbar renders as a fixed bottom bar in compact mode
    const toolbar = page.locator('.fixed.bottom-0').first();
    await expect(toolbar).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  test('sidebar collapses to drawer at 390px', async ({ page }) => {
    // At widths < 1024px the persistent aside sidebar must not occupy layout space
    const sidebar = page.locator('aside[aria-label="Editor tools"]').first();
    const isVisible = await sidebar.isVisible().catch(() => false);
    if (isVisible) {
      const box = await sidebar.boundingBox();
      // If present in DOM it must be collapsed (width ~0) or off-screen
      expect(box === null || box.width < 10).toBe(true);
    }
    // Absent from DOM is also acceptable compact-mode behaviour
  });

  test('canvas area takes full viewport width', async ({ page }) => {
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    const viewportWidth = page.viewportSize()!.width;
    // Canvas should occupy at least 85% of viewport width in compact mode
    expect(canvasBox!.width).toBeGreaterThan(viewportWidth * 0.85);
  });
});

// ---------------------------------------------------------------------------
// Pixel 7 (412x915)
// ---------------------------------------------------------------------------
test.describe('Pixel 7 Viewport (412x915) @ui @dev', () => {
  test.use({ viewport: { width: 412, height: 915 } });

  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  test('page loads at Pixel 7 resolution', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).toBeVisible();
    const box = await body.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(412);
  });

  test('editor does not become document-scrollable', async ({ page }) => {
    await expectViewportContained(page);
  });

  test('mobile toolbar appears in compact layout', async ({ page }) => {
    const toolbar = page.locator('.fixed.bottom-0').first();
    await expect(toolbar).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  test('sidebar collapses to drawer at 412px', async ({ page }) => {
    const sidebar = page.locator('aside[aria-label="Editor tools"]').first();
    const isVisible = await sidebar.isVisible().catch(() => false);
    if (isVisible) {
      const box = await sidebar.boundingBox();
      expect(box === null || box.width < 10).toBe(true);
    }
  });

  test('canvas area takes full viewport width', async ({ page }) => {
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    const viewportWidth = page.viewportSize()!.width;
    expect(canvasBox!.width).toBeGreaterThan(viewportWidth * 0.85);
  });

  test('mobile toolbar is anchored to bottom of viewport', async ({ page }) => {
    const toolbar = page.locator('.fixed.bottom-0').first();
    await expect(toolbar).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    const box = await toolbar.boundingBox();
    expect(box).not.toBeNull();
    const viewportHeight = page.viewportSize()!.height;
    // Bottom edge must reach within 20px of the viewport bottom
    expect(box!.y + box!.height).toBeGreaterThanOrEqual(viewportHeight - 20);
  });

  test('mobile toolbar spans full viewport width', async ({ page }) => {
    const toolbar = page.locator('.fixed.bottom-0').first();
    await expect(toolbar).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    const box = await toolbar.boundingBox();
    expect(box).not.toBeNull();
    const viewportWidth = page.viewportSize()!.width;
    // Allow 80px tolerance for safe-area insets and margins
    expect(box!.width).toBeGreaterThan(viewportWidth - 80);
  });
});
