import { test, expect } from '../fixtures/editor.fixture';

/**
 * PF-673: Mobile viewport E2E tests.
 *
 * Verifies the editor layout adapts correctly across iPhone 14 (390x844) and
 * iPad (768x1024) viewports: sidebar collapse, mobile toolbar visibility,
 * WCAG 2.5.5 touch target sizes (44x44 CSS px minimum), and panel access via
 * mobile toggle buttons.
 *
 * All tests use @ui tag — no WASM engine required. Uses loadPage() which sets
 * __SKIP_ENGINE and waits for __REACT_HYDRATED.
 */

// ---------------------------------------------------------------------------
// iPhone 14 (390x844)
// ---------------------------------------------------------------------------
test.describe('iPhone 14 Viewport (390x844) @ui', () => {
  test.beforeEach(async ({ page, editor }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await editor.loadPage();
  });

  test('canvas is visible', async ({ page }) => {
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });
  });

  test('editor layout renders at iPhone 14 size', async ({ page }) => {
    // The outermost editor container should be present and non-zero in size
    const body = page.locator('body');
    await expect(body).toBeVisible();
    const box = await body.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(390);
  });

  test('sidebar is collapsed or absent at 390px width', async ({ page }) => {
    // At compact viewport (< 1024px) the aside sidebar must not occupy space
    const sidebar = page.locator('aside[aria-label="Editor tools"]').first();
    const isVisible = await sidebar.isVisible().catch(() => false);
    if (isVisible) {
      const box = await sidebar.boundingBox();
      // If present in DOM it must be collapsed (width near 0) or off-screen
      expect(box === null || box.width < 10).toBe(true);
    }
    // Being absent from DOM is also correct compact-mode behaviour
  });

  test('mobile toolbar is visible', async ({ page }) => {
    const toolbar = page.locator('.fixed.bottom-0').first();
    await expect(toolbar).toBeVisible({ timeout: 5_000 });
  });

  test('mobile toolbar spans full viewport width', async ({ page }) => {
    const toolbar = page.locator('.fixed.bottom-0').first();
    await expect(toolbar).toBeVisible({ timeout: 5_000 });

    const box = await toolbar.boundingBox();
    expect(box).not.toBeNull();
    const viewportWidth = page.viewportSize()!.width;
    // Allow 80px tolerance for safe-area insets and margins
    expect(box!.width).toBeGreaterThan(viewportWidth - 80);
  });

  test('mobile toolbar is anchored to the bottom of the viewport', async ({ page }) => {
    const toolbar = page.locator('.fixed.bottom-0').first();
    await expect(toolbar).toBeVisible({ timeout: 5_000 });

    const box = await toolbar.boundingBox();
    expect(box).not.toBeNull();
    const viewportHeight = page.viewportSize()!.height;
    // Bottom edge must reach within 20px of the viewport bottom
    expect(box!.y + box!.height).toBeGreaterThanOrEqual(viewportHeight - 20);
  });

  test('scene hierarchy panel is accessible via mobile toggle', async ({ page }) => {
    const hierarchyToggle = page.locator('button[title="Scene Hierarchy"]');
    await expect(hierarchyToggle).toBeVisible({ timeout: 5_000 });

    await hierarchyToggle.click();

    const drawer = page.locator('[aria-label="Scene hierarchy panel"]');
    await expect(drawer).toBeInViewport({ timeout: 5_000 });
  });

  test('inspector panel is accessible via mobile toggle', async ({ page }) => {
    const inspectorToggle = page.locator('button[title="Inspector"]');
    await expect(inspectorToggle).toBeVisible({ timeout: 5_000 });

    await inspectorToggle.click();

    // Inspector drawer should become visible/in-viewport
    const drawer = page.locator('[aria-label="Inspector panel"]');
    await expect(drawer).toBeInViewport({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// iPad (768x1024)
// ---------------------------------------------------------------------------
test.describe('iPad Viewport (768x1024) @ui', () => {
  test.beforeEach(async ({ page, editor }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await editor.loadPage();
  });

  test('canvas is visible', async ({ page }) => {
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });
  });

  test('editor layout renders at iPad size', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).toBeVisible();
    const box = await body.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(768);
  });

  test('sidebar is collapsed or absent at 768px width', async ({ page }) => {
    // 768px < 1024px breakpoint — sidebar is still in compact mode
    const sidebar = page.locator('aside[aria-label="Editor tools"]').first();
    const isVisible = await sidebar.isVisible().catch(() => false);
    if (isVisible) {
      const box = await sidebar.boundingBox();
      expect(box === null || box.width < 10).toBe(true);
    }
  });

  test('mobile toolbar is visible at tablet width', async ({ page }) => {
    const toolbar = page.locator('.fixed.bottom-0').first();
    await expect(toolbar).toBeVisible({ timeout: 5_000 });
  });

  test('scene hierarchy panel is accessible via mobile toggle', async ({ page }) => {
    const hierarchyToggle = page.locator('button[title="Scene Hierarchy"]');
    await expect(hierarchyToggle).toBeVisible({ timeout: 5_000 });

    await hierarchyToggle.click();

    const drawer = page.locator('[aria-label="Scene hierarchy panel"]');
    await expect(drawer).toBeInViewport({ timeout: 5_000 });
  });

  test('inspector panel is accessible via mobile toggle', async ({ page }) => {
    const inspectorToggle = page.locator('button[title="Inspector"]');
    await expect(inspectorToggle).toBeVisible({ timeout: 5_000 });

    await inspectorToggle.click();

    const drawer = page.locator('[aria-label="Inspector panel"]');
    await expect(drawer).toBeInViewport({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// WCAG 2.5.5 Touch Target Sizes (44x44 CSS px minimum) — both viewports
// ---------------------------------------------------------------------------
test.describe('Touch Target Sizes @ui', () => {
  for (const [label, viewport] of [
    ['iPhone 14 (390x844)', { width: 390, height: 844 }],
    ['iPad (768x1024)', { width: 768, height: 1024 }],
  ] as const) {
    test.describe(label, () => {
      test.beforeEach(async ({ page, editor }) => {
        await page.setViewportSize(viewport);
        await editor.loadPage();
      });

      test('Move gizmo button meets 44x44px WCAG 2.5.5 minimum', async ({ page }) => {
        const btn = page.locator('button[title="Move"]');
        await expect(btn).toBeVisible({ timeout: 5_000 });
        const box = await btn.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      });

      test('Rotate gizmo button meets 44x44px WCAG 2.5.5 minimum', async ({ page }) => {
        const btn = page.locator('button[title="Rotate"]');
        await expect(btn).toBeVisible({ timeout: 5_000 });
        const box = await btn.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      });

      test('Scale gizmo button meets 44x44px WCAG 2.5.5 minimum', async ({ page }) => {
        const btn = page.locator('button[title="Scale"]');
        await expect(btn).toBeVisible({ timeout: 5_000 });
        const box = await btn.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      });

      test('Scene Hierarchy toggle meets 44x44px WCAG 2.5.5 minimum', async ({ page }) => {
        const btn = page.locator('button[title="Scene Hierarchy"]');
        await expect(btn).toBeVisible({ timeout: 5_000 });
        const box = await btn.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      });

      test('Inspector toggle meets 44x44px WCAG 2.5.5 minimum', async ({ page }) => {
        const btn = page.locator('button[title="Inspector"]');
        await expect(btn).toBeVisible({ timeout: 5_000 });
        const box = await btn.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      });
    });
  }
});
