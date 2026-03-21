import { test, expect } from '../fixtures/editor.fixture';

/**
 * PF-673: Mobile viewport E2E tests.
 *
 * Tests that the editor layout adapts correctly for iPhone 14 (390×844)
 * and iPad (768×1024) viewports:
 *   - Sidebar collapses and mobile toolbar appears in compact mode
 *   - Touch-friendly controls (≥44px) are visible on small screens
 *   - Panels are accessible via mobile menu (hierarchy / inspector drawers)
 *   - Canvas area fills the available space
 *
 * All tests are @ui — uses loadPage() (no WASM engine required).
 *
 * Breakpoints (from useResponsiveLayout):
 *   compact   : width < 1024  — sidebar hidden, mobile toolbar shown
 *   condensed : 1024 ≤ width < 1440
 *   full      : width ≥ 1440
 */

// ---------------------------------------------------------------------------
// iPhone 14 — 390×844
// ---------------------------------------------------------------------------
test.describe('iPhone 14 viewport (390×844) @ui', () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeEach(async ({ page, editor }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await editor.loadPage();
  });

  test('canvas is visible and fills available space', async ({ page }) => {
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    // Canvas should fill most of the viewport width (compact mode = no sidebar)
    const vp = page.viewportSize()!;
    expect(box!.width).toBeGreaterThan(vp.width * 0.7);
  });

  test('sidebar collapses — not visible or zero-width', async ({ page }) => {
    const sidebar = page.locator('aside[aria-label="Editor tools"]').first();
    const sidebarVisible = await sidebar.isVisible().catch(() => false);

    if (sidebarVisible) {
      const box = await sidebar.boundingBox();
      // Collapsed sidebar must be ≤ 10px wide or off-screen
      expect(box === null || box.width < 10).toBe(true);
    }
    // Sidebar absent from DOM is correct compact-mode behaviour
  });

  test('mobile toolbar is shown at the bottom', async ({ page }) => {
    // MobileToolbar renders as fixed bottom-0 with full width in compact mode
    const toolbar = page.locator('.fixed.bottom-0').first();
    await expect(toolbar).toBeVisible({ timeout: 5_000 });

    const box = await toolbar.boundingBox();
    expect(box).not.toBeNull();

    const vp = page.viewportSize()!;
    // Spans full viewport width (within 20px margin)
    expect(box!.width).toBeGreaterThan(vp.width - 20);
    // Anchored to viewport bottom (within 20px)
    expect(box!.y + box!.height).toBeGreaterThanOrEqual(vp.height - 20);
  });

  test('gizmo tool buttons have touch-friendly size (≥44px)', async ({ page }) => {
    const buttons = [
      page.locator('button[title="Move"]'),
      page.locator('button[title="Rotate"]'),
      page.locator('button[title="Scale"]'),
    ];

    for (const btn of buttons) {
      await expect(btn).toBeVisible({ timeout: 5_000 });
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      // WCAG 2.5.5 Level AAA: 44×44 CSS px minimum touch target
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('panel toggle buttons are accessible via mobile toolbar', async ({ page }) => {
    const hierarchyToggle = page.locator('button[title="Scene Hierarchy"]');
    const inspectorToggle = page.locator('button[title="Inspector"]');

    await expect(hierarchyToggle).toBeVisible({ timeout: 5_000 });
    await expect(inspectorToggle).toBeVisible({ timeout: 5_000 });
  });

  test('hierarchy panel opens via mobile menu toggle', async ({ page }) => {
    const hierarchyToggle = page.locator('button[title="Scene Hierarchy"]');
    await expect(hierarchyToggle).toBeVisible({ timeout: 5_000 });

    await hierarchyToggle.click();

    // Drawer slides in to viewport
    const drawer = page.locator('[aria-label="Scene hierarchy panel"]');
    await expect(drawer).toBeInViewport({ timeout: 5_000 });
  });

  test('hierarchy panel closes on Escape', async ({ page }) => {
    const hierarchyToggle = page.locator('button[title="Scene Hierarchy"]');
    await expect(hierarchyToggle).toBeVisible({ timeout: 5_000 });
    await hierarchyToggle.click();

    const drawer = page.locator('[aria-label="Scene hierarchy panel"]');
    await expect(drawer).toBeInViewport({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeInViewport({ timeout: 5_000 });
  });

  test('inspector panel toggle has touch-friendly size (≥44px)', async ({ page }) => {
    const inspectorToggle = page.locator('button[title="Inspector"]');
    await expect(inspectorToggle).toBeVisible({ timeout: 5_000 });

    const box = await inspectorToggle.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

// ---------------------------------------------------------------------------
// iPad — 768×1024
// ---------------------------------------------------------------------------
test.describe('iPad viewport (768×1024) @ui', () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeEach(async ({ page, editor }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await editor.loadPage();
  });

  test('canvas is visible and fills available space', async ({ page }) => {
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    // At 768px (compact mode), canvas should fill most of viewport
    const vp = page.viewportSize()!;
    expect(box!.width).toBeGreaterThan(vp.width * 0.6);
  });

  test('sidebar collapses at 768px — compact mode boundary', async ({ page }) => {
    // 768px < 1024px compact threshold — sidebar must be hidden or collapsed
    const sidebar = page.locator('aside[aria-label="Editor tools"]').first();
    const sidebarVisible = await sidebar.isVisible().catch(() => false);

    if (sidebarVisible) {
      const box = await sidebar.boundingBox();
      expect(box === null || box.width < 10).toBe(true);
    }
  });

  test('mobile toolbar is visible at 768px', async ({ page }) => {
    const toolbar = page.locator('.fixed.bottom-0').first();
    await expect(toolbar).toBeVisible({ timeout: 5_000 });

    const box = await toolbar.boundingBox();
    expect(box).not.toBeNull();

    const vp = page.viewportSize()!;
    expect(box!.width).toBeGreaterThan(vp.width - 20);
  });

  test('gizmo tool buttons have touch-friendly size (≥44px)', async ({ page }) => {
    const buttons = [
      page.locator('button[title="Move"]'),
      page.locator('button[title="Rotate"]'),
      page.locator('button[title="Scale"]'),
    ];

    for (const btn of buttons) {
      await expect(btn).toBeVisible({ timeout: 5_000 });
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('panel toggle buttons are accessible via mobile toolbar', async ({ page }) => {
    await expect(page.locator('button[title="Scene Hierarchy"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('button[title="Inspector"]')).toBeVisible({ timeout: 5_000 });
  });

  test('hierarchy panel opens and is within viewport', async ({ page }) => {
    const hierarchyToggle = page.locator('button[title="Scene Hierarchy"]');
    await expect(hierarchyToggle).toBeVisible({ timeout: 5_000 });

    await hierarchyToggle.click();

    const drawer = page.locator('[aria-label="Scene hierarchy panel"]');
    await expect(drawer).toBeInViewport({ timeout: 5_000 });
  });

  test('hierarchy panel closes on Escape', async ({ page }) => {
    const hierarchyToggle = page.locator('button[title="Scene Hierarchy"]');
    await expect(hierarchyToggle).toBeVisible({ timeout: 5_000 });
    await hierarchyToggle.click();

    const drawer = page.locator('[aria-label="Scene hierarchy panel"]');
    await expect(drawer).toBeInViewport({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeInViewport({ timeout: 5_000 });
  });

  test('canvas has non-zero dimensions', async ({ page }) => {
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(200);
    expect(box!.height).toBeGreaterThan(200);
  });
});

// ---------------------------------------------------------------------------
// Cross-viewport: layout transition
// ---------------------------------------------------------------------------
test.describe('Viewport transition behaviour @ui', () => {
  test('canvas remains visible transitioning iPhone 14 to desktop', async ({ page, editor }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await editor.loadPage();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(canvas).toBeVisible({ timeout: 5_000 });
  });

  test('canvas remains visible transitioning iPad to desktop', async ({ page, editor }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await editor.loadPage();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(canvas).toBeVisible({ timeout: 5_000 });
  });

  test('sidebar appears when transitioning from mobile to desktop', async ({ page, editor }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await editor.loadPage();

    // In compact mode sidebar is hidden
    const sidebar = page.locator('aside[aria-label="Editor tools"]').first();

    // Expand to full desktop
    await page.setViewportSize({ width: 1440, height: 900 });
    // Brief settle time for layout reflow
    await page.waitForTimeout(300);

    await expect(sidebar).toBeVisible({ timeout: 5_000 });
    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(10);
  });
});
