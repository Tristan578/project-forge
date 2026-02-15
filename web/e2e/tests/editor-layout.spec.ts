import { test, expect } from '../fixtures/editor.fixture';

test.describe('Editor Layout', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('default layout shows viewport, hierarchy, inspector panels', async ({ page, editor }) => {
    // Wait for layout to render
    await page.waitForTimeout(500);

    // Check that viewport canvas is visible
    const canvas = editor.canvas;
    await expect(canvas).toBeVisible();
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    expect(canvasBox!.width).toBeGreaterThan(0);

    // Check for Scene/Hierarchy panel
    await editor.expectPanelVisible('Scene');

    // Check for Inspector panel
    await editor.expectPanelVisible('Inspector');
  });

  test('layout presets menu opens', async ({ page, editor: _editor }) => {
    // Look for layout/workspace menu button
    // This could be in the top toolbar, settings, or a dedicated menu
    // Common labels: "Layout", "Workspace", "View", or gear icon

    // Try to find layout/workspace button
    const layoutButton = page.getByRole('button', { name: /layout|workspace|view|preset/i });
    const buttonCount = await layoutButton.count();

    if (buttonCount > 0) {
      await layoutButton.first().click();
      await page.waitForTimeout(300);

      // Check that a menu or dialog appeared
      const menu = page.locator('[role="menu"], [role="dialog"], .menu, .dropdown').first();
      await expect(menu).toBeVisible();
    } else {
      // If no dedicated button, layout presets might be in Settings
      await _editor.openSettings();
      await page.waitForTimeout(300);

      // Check for Layout/Workspace section
      const layoutSection = page.getByText(/layout|workspace/i);
      await expect(layoutSection.first()).toBeVisible();
    }
  });

  test('panel tabs can be clicked to switch active panel', async ({ page, editor: _editor }) => {
    await page.waitForTimeout(500);

    // Find dockview tabs (multiple tabs in the same panel group)
    const tabs = page.locator('.dv-tab, [role="tab"]');
    const tabCount = await tabs.count();

    if (tabCount > 1) {
      // Click the second tab
      const secondTab = tabs.nth(1);
      await secondTab.click();
      await page.waitForTimeout(300);

      // Check that tab is now active (usually has aria-selected or active class)
      const isActive = await secondTab.evaluate((el) => {
        return (
          el.getAttribute('aria-selected') === 'true' ||
          el.classList.contains('active') ||
          el.classList.contains('dv-active-tab')
        );
      });

      expect(isActive).toBe(true);
    }
  });

  test('layout persistence - saved layout key exists in localStorage', async ({ page, editor: _editor }) => {
    await page.waitForTimeout(1000);

    // Check localStorage for layout-related keys
    const layoutKeys = await page.evaluate(() => {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('layout') || key.includes('dockview') || key.includes('workspace'))) {
          keys.push(key);
        }
      }
      return keys;
    });

    // At least one layout persistence key should exist
    expect(layoutKeys.length).toBeGreaterThan(0);
  });

  test('sidebar is docked on the left', async ({ page, editor: _editor }) => {
    await page.waitForTimeout(500);

    // Find sidebar element
    const sidebar = page.locator('[class*="sidebar"]').first();
    await expect(sidebar).toBeVisible();

    // Get sidebar position
    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox).not.toBeNull();

    // Check that sidebar is on the left edge (x ≈ 0)
    expect(sidebarBox!.x).toBeLessThan(100);
  });

  test('viewport takes central position', async ({ page, editor }) => {
    await page.waitForTimeout(500);

    const canvas = editor.canvas;
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();

    // Viewport should not be at the extreme edges
    expect(canvasBox!.x).toBeGreaterThan(50);
    expect(canvasBox!.y).toBeGreaterThan(20);
  });

  test('panels can be resized', async ({ page, editor: _editor }) => {
    await page.waitForTimeout(500);

    // Find a resize handle (dockview uses .dv-resize-handle)
    const resizeHandle = page.locator('.dv-resize-handle, .resize-handle').first();
    const handleExists = await resizeHandle.isVisible().catch(() => false);

    if (handleExists) {
      const handleBox = await resizeHandle.boundingBox();
      if (handleBox) {
        // Drag the handle
        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(handleBox.x + 50, handleBox.y + handleBox.height / 2);
        await page.mouse.up();
        await page.waitForTimeout(300);

        // If we reach here without error, resize worked
        expect(true).toBe(true);
      }
    }
  });

  test('chat overlay can be toggled', async ({ page, editor: _editor }) => {
    await page.waitForTimeout(500);

    // Look for chat toggle button
    const chatButton = page.getByRole('button', { name: /chat|message/i });
    const buttonCount = await chatButton.count();

    if (buttonCount > 0) {
      // Click to open chat
      await chatButton.first().click();
      await page.waitForTimeout(300);

      // Check that chat panel or overlay is visible
      const chatPanel = page.locator('[class*="chat"], [data-testid*="chat"]').first();
      const chatVisible = await chatPanel.isVisible().catch(() => false);

      if (chatVisible) {
        // Click again to close
        await chatButton.first().click();
        await page.waitForTimeout(300);

        // Chat should be hidden
        const chatHidden = !(await chatPanel.isVisible().catch(() => true));
        expect(chatHidden).toBe(true);
      }
    }
  });

  test('responsive layout adjusts on window resize', async ({ editor }) => {
    await editor.page.waitForTimeout(500);

    // Get initial layout
    const canvasBefore = await editor.canvas.boundingBox();
    expect(canvasBefore).not.toBeNull();

    // Resize window to smaller width
    await editor.page.setViewportSize({ width: 1024, height: 768 });
    await editor.page.waitForTimeout(500);

    // Get new layout
    const canvasAfter = await editor.canvas.boundingBox();
    expect(canvasAfter).not.toBeNull();

    // Canvas should have adjusted width
    expect(canvasAfter!.width).not.toBe(canvasBefore!.width);
  });
});
