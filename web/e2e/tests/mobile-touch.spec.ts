import { test, expect } from '../fixtures/editor.fixture';
import { E2E_TIMEOUT_ELEMENT_MS, E2E_TIMEOUT_LOAD_MS } from '../constants';

/**
 * PF-41: Mobile touch controls and responsive layout E2E tests.
 *
 * Covers responsive breakpoints, compact-mode sidebar collapse, WCAG touch-target
 * sizes, virtual joystick store configuration, and canvas presence across viewports.
 *
 * All tests are @ui (no WASM engine required) — uses loadPage() which sets
 * __SKIP_ENGINE and waits for __REACT_HYDRATED.
 *
 * Breakpoints (from useResponsiveLayout):
 *   compact   : width < 1024 (sidebar hidden, mobile toolbar shown)
 *   condensed : 1024 ≤ width < 1440 (panels shown at reduced size)
 *   full      : width ≥ 1440 (all panels at full size)
 */

// ---------------------------------------------------------------------------
// Responsive Layout Breakpoints
// ---------------------------------------------------------------------------
test.describe('Responsive Layout Breakpoints @ui @dev', () => {
  test('mobile viewport (375×667) shows canvas', async ({ page, editor }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await editor.loadPage();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });
  });

  test('tablet viewport (768×1024) shows canvas', async ({ page, editor }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await editor.loadPage();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });
  });

  test('desktop viewport (1280×800) shows canvas', async ({ page, editor }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await editor.loadPage();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });
  });

  test('small mobile viewport (320×568) shows canvas', async ({ page, editor }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await editor.loadPage();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });
  });

  test('tablet landscape viewport (1024×768) shows canvas', async ({ page, editor }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await editor.loadPage();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });
  });

  test('full desktop viewport (1440×900) shows canvas', async ({ page, editor }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await editor.loadPage();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });
  });

  test('canvas is visible after switching from mobile to desktop viewport', async ({ page, editor }) => {
    // Start at mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await editor.loadPage();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

    // Resize to desktop
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  test('canvas is visible after switching from desktop to mobile viewport', async ({ page, editor }) => {
    // Start at desktop
    await page.setViewportSize({ width: 1440, height: 900 });
    await editor.loadPage();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

    // Resize to mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });
});

// ---------------------------------------------------------------------------
// Compact Mode — Sidebar Collapse
// ---------------------------------------------------------------------------
test.describe('Mobile Sidebar Collapse @ui @dev', () => {
  test('sidebar is hidden at mobile viewport (375px)', async ({ page, editor }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await editor.loadPage();

    // In compact mode the sidebar is not rendered or has zero width
    const sidebar = page.locator('aside[aria-label="Editor tools"]').first();
    const sidebarVisible = await sidebar.isVisible().catch(() => false);

    if (sidebarVisible) {
      const box = await sidebar.boundingBox();
      // If it exists in DOM it must be collapsed (width ≈ 0) or off-screen
      expect(box === null || box.width < 10).toBe(true);
    }
    // Sidebar being absent from DOM is also correct compact-mode behaviour
  });

  test('sidebar is hidden at narrow tablet viewport (768px)', async ({ page, editor }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await editor.loadPage();

    const sidebar = page.locator('aside[aria-label="Editor tools"]').first();
    const sidebarVisible = await sidebar.isVisible().catch(() => false);

    if (sidebarVisible) {
      const box = await sidebar.boundingBox();
      expect(box === null || box.width < 10).toBe(true);
    }
  });

  test('sidebar is visible at condensed desktop viewport (1280px)', async ({ page, editor }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await editor.loadPage();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

    // At >= 1024px (condensed/full mode) sidebar should be rendered and visible
    const sidebar = page.locator('aside[aria-label="Editor tools"]').first();
    await expect(sidebar).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// Mobile Toolbar
// ---------------------------------------------------------------------------
test.describe('Mobile Toolbar @ui @dev', () => {
  test('mobile toolbar is visible at compact viewport', async ({ page, editor }) => {
    await page.setViewportSize({ width: 768, height: 600 });
    await editor.loadPage();

    // MobileToolbar is fixed bottom-0 with h-12 (48px)
    const mobileToolbar = page.locator('.fixed.bottom-0').first();
    await expect(mobileToolbar).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  test('mobile toolbar spans full width at compact viewport', async ({ page, editor }) => {
    await page.setViewportSize({ width: 768, height: 600 });
    await editor.loadPage();

    const mobileToolbar = page.locator('.fixed.bottom-0').first();
    await expect(mobileToolbar).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    const box = await mobileToolbar.boundingBox();
    expect(box).not.toBeNull();
    // Should cover close to the full viewport width (within 80px tolerance for margins)
    const viewportWidth = page.viewportSize()!.width;
    expect(box!.width).toBeGreaterThan(viewportWidth - 80);
  });

  test('mobile toolbar is anchored to bottom of viewport', async ({ page, editor }) => {
    await page.setViewportSize({ width: 768, height: 600 });
    await editor.loadPage();

    const mobileToolbar = page.locator('.fixed.bottom-0').first();
    await expect(mobileToolbar).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    const box = await mobileToolbar.boundingBox();
    expect(box).not.toBeNull();
    // Bottom edge should reach near the viewport bottom (within 20px tolerance)
    const viewportHeight = page.viewportSize()!.height;
    expect(box!.y + box!.height).toBeGreaterThanOrEqual(viewportHeight - 20);
  });

  test('gizmo tool buttons are present in mobile toolbar', async ({ page, editor }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await editor.loadPage();

    await expect(page.locator('button[title="Move"]')).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await expect(page.locator('button[title="Rotate"]')).toBeVisible();
    await expect(page.locator('button[title="Scale"]')).toBeVisible();
  });

  test('hierarchy toggle button is present in mobile toolbar', async ({ page, editor }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await editor.loadPage();

    const hierarchyToggle = page.locator('button[title="Scene Hierarchy"]');
    await expect(hierarchyToggle).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  test('inspector toggle button is present in mobile toolbar', async ({ page, editor }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await editor.loadPage();

    const inspectorToggle = page.locator('button[title="Inspector"]');
    await expect(inspectorToggle).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });
});

// ---------------------------------------------------------------------------
// WCAG Touch Target Sizes (min 44×44px)
// ---------------------------------------------------------------------------
test.describe('Touch Target Sizes @ui @dev', () => {
  test('mobile toolbar gizmo buttons meet minimum touch target size', async ({ page, editor }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await editor.loadPage();

    // WCAG 2.5.5 requires 44×44 CSS pixels for touch targets.
    const moveBtn = page.locator('button[title="Move"]');
    await expect(moveBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    const box = await moveBtn.boundingBox();
    expect(box).not.toBeNull();
    // WCAG 2.5.5 Level AAA requires 44×44 CSS px touch targets
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('hierarchy toggle button meets minimum touch target size', async ({ page, editor }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await editor.loadPage();

    const hierarchyToggle = page.locator('button[title="Scene Hierarchy"]');
    await expect(hierarchyToggle).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    const box = await hierarchyToggle.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('inspector toggle button meets minimum touch target size', async ({ page, editor }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await editor.loadPage();

    const inspectorToggle = page.locator('button[title="Inspector"]');
    await expect(inspectorToggle).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    const box = await inspectorToggle.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('rotate gizmo button meets minimum touch target size', async ({ page, editor }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await editor.loadPage();

    const rotateBtn = page.locator('button[title="Rotate"]');
    await expect(rotateBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    const box = await rotateBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

// ---------------------------------------------------------------------------
// Virtual Joystick Store Configuration
// ---------------------------------------------------------------------------
test.describe('Virtual Joystick Store Config @ui @dev', () => {
  test('mobileTouchConfig exists in store with enabled flag', async ({ editor }) => {
    await editor.loadPage();

    const touchConfig = await editor.getStoreState<Record<string, unknown> | null>('mobileTouchConfig');

    expect(touchConfig).not.toBeNull();
    expect(typeof touchConfig!.enabled).toBe('boolean');
  });

  test('mobileTouchConfig has joystick config when preset includes joystick', async ({ editor }) => {
    await editor.loadPage();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const joystick = await editor.getStoreState<any>('mobileTouchConfig.joystick');

    // Joystick may be null for presets that don't include one (e.g. buttons-only).
    // When present, validate its shape.
    if (joystick !== null) {
      expect(['bottom-left', 'bottom-right']).toContain(joystick.position);
      expect(typeof joystick.size).toBe('number');
      expect(joystick.size).toBeGreaterThan(0);
      expect(typeof joystick.opacity).toBe('number');
    }
  });

  test('mobileTouchConfig has autoDetect boolean', async ({ editor }) => {
    await editor.loadPage();

    const autoDetect = await editor.getStoreState<boolean | null>('mobileTouchConfig.autoDetect');

    expect(autoDetect).not.toBeNull();
    expect(typeof autoDetect).toBe('boolean');
  });

  test('mobileTouchConfig has valid preset string', async ({ editor }) => {
    await editor.loadPage();

    const preset = await editor.getStoreState<string | null>('mobileTouchConfig.preset');

    expect(preset).not.toBeNull();
    expect(typeof preset).toBe('string');
    expect(preset!.length).toBeGreaterThan(0);
  });

  test('mobileTouchConfig.buttons is an array', async ({ editor }) => {
    await editor.loadPage();

    const buttons = await editor.getStoreState<unknown[] | null>('mobileTouchConfig.buttons');

    expect(buttons).not.toBeNull();
    expect(Array.isArray(buttons)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Canvas Rendering Across Breakpoints
// ---------------------------------------------------------------------------
test.describe('Canvas Rendering Across Breakpoints @ui @dev', () => {
  test('canvas has non-zero dimensions at mobile viewport', async ({ page, editor }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await editor.loadPage();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test('canvas has non-zero dimensions at tablet viewport', async ({ page, editor }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await editor.loadPage();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test('canvas has non-zero dimensions at desktop viewport', async ({ page, editor }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await editor.loadPage();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test('canvas width increases as viewport widens', async ({ page, editor }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await editor.loadPage();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

    const mobileBox = await canvas.boundingBox();
    expect(mobileBox).not.toBeNull();

    await page.setViewportSize({ width: 1440, height: 900 });
    // Wait for the canvas to respond to the viewport change before measuring
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    const desktopBox = await canvas.boundingBox();
    expect(desktopBox).not.toBeNull();

    // Desktop canvas should be wider than mobile canvas
    expect(desktopBox!.width).toBeGreaterThan(mobileBox!.width);
  });

  test('canvas remains visible after rapid viewport resizes', async ({ page, editor }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await editor.loadPage();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

    const viewports = [
      { width: 375, height: 667 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
      { width: 375, height: 667 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    }
  });
});

// ---------------------------------------------------------------------------
// Drawer Panel (mobile hierarchy / inspector)
// ---------------------------------------------------------------------------
test.describe('Mobile Drawer Panels @ui @dev', () => {
  test('hierarchy drawer opens on toggle button click', async ({ page, editor }) => {
    await page.setViewportSize({ width: 768, height: 600 });
    await editor.loadPage();

    const hierarchyToggle = page.locator('button[title="Scene Hierarchy"]');
    await expect(hierarchyToggle).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    await hierarchyToggle.click();

    const drawer = page.locator('[aria-label="Scene hierarchy panel"]');
    await expect(drawer).toBeInViewport({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  test('hierarchy drawer closes on Escape key', async ({ page, editor }) => {
    await page.setViewportSize({ width: 768, height: 600 });
    await editor.loadPage();

    const hierarchyToggle = page.locator('button[title="Scene Hierarchy"]');
    await expect(hierarchyToggle).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    await hierarchyToggle.click();

    const drawer = page.locator('[aria-label="Scene hierarchy panel"]');
    await expect(drawer).toBeInViewport({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeInViewport({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });
});
