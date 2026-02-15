import { test, expect } from '../fixtures/editor.fixture';

test.describe('Modals', () => {
  test('settings modal opens and is visible', async ({ page, editor }) => {
    await editor.loadPage();

    // Open settings modal
    await editor.openSettings();

    // Settings modal should be visible
    const settingsModal = page.locator('[class*="fixed"]').filter({ hasText: /settings/i }).first();
    await expect(settingsModal).toBeVisible();
  });

  test('settings modal has tabs', async ({ page, editor }) => {
    await editor.loadPage();

    // Open settings
    await editor.openSettings();

    // Look for tab buttons (Tokens, API Keys, Billing)
    const tokensTab = page.getByRole('button', { name: /tokens/i });
    const keysTab = page.getByRole('button', { name: /api.*keys|keys/i });
    const billingTab = page.getByRole('button', { name: /billing/i });

    const tabCount = await Promise.all([
      tokensTab.isVisible().catch(() => false),
      keysTab.isVisible().catch(() => false),
      billingTab.isVisible().catch(() => false),
    ]).then((results) => results.filter(Boolean).length);

    expect(tabCount).toBeGreaterThan(0);
  });

  test('settings modal can be closed', async ({ page, editor }) => {
    await editor.loadPage();

    // Open settings
    await editor.openSettings();

    // Find close button
    const closeBtn = page.locator('button').filter({ hasText: /×|close/i }).first();
    await closeBtn.click();
    await page.waitForTimeout(300);

    // Modal should be gone
    const settingsModal = page.locator('[class*="fixed"]').filter({ hasText: /settings/i }).first();
    const visible = await settingsModal.isVisible().catch(() => false);
    expect(visible).toBe(false);
  });

  test('settings modal can be closed with Escape key', async ({ page, editor }) => {
    await editor.loadPage();

    // Open settings
    await editor.openSettings();

    // Press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Modal should be gone
    const settingsModal = page.locator('[class*="fixed"]').filter({ hasText: /settings/i }).first();
    const visible = await settingsModal.isVisible().catch(() => false);
    expect(visible).toBe(false);
  });

  test('welcome modal appears on first visit', async ({ page, editor: _editor }) => {
    // Clear localStorage to simulate first visit
    await page.goto('/dev');
    await page.evaluate(() => {
      localStorage.removeItem('forge-welcomed');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Welcome modal should be visible
    const welcomeModal = page.locator('[class*="fixed"]').filter({ hasText: /welcome|getting started/i }).first();
    const visible = await welcomeModal.isVisible().catch(() => false);
    expect(visible).toBe(true);
  });

  test('keyboard shortcuts modal opens with ? key', async ({ page, editor }) => {
    await editor.loadPage();

    // Press ? key (Shift+/)
    await page.keyboard.press('?');
    await page.waitForTimeout(300);

    // Shortcuts modal should be visible
    const shortcutsModal = page.locator('[class*="fixed"], [class*="modal"]').filter({ hasText: /shortcut|keyboard/i }).first();
    const visible = await shortcutsModal.isVisible().catch(() => false);
    expect(visible).toBe(true);
  });

  test('keyboard shortcuts modal can be closed with Escape', async ({ page, editor }) => {
    await editor.loadPage();

    // Open shortcuts with ?
    await page.keyboard.press('?');
    await page.waitForTimeout(300);

    // Close with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Modal should be gone
    const shortcutsModal = page.locator('[class*="fixed"], [class*="modal"]').filter({ hasText: /shortcut|keyboard/i }).first();
    const visible = await shortcutsModal.isVisible().catch(() => false);
    expect(visible).toBe(false);
  });

  test('modals appear above other content (z-index)', async ({ page, editor }) => {
    await editor.loadPage();

    // Open settings modal
    await editor.openSettings();

    // Check z-index of modal
    const settingsModal = page.locator('[class*="fixed"]').filter({ hasText: /settings/i }).first();
    const zIndex = await settingsModal.evaluate((el) => {
      return parseInt(window.getComputedStyle(el).zIndex, 10);
    });

    // Should be a high z-index (typically 50+)
    expect(zIndex).toBeGreaterThan(40);
  });
});
