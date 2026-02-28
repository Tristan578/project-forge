import { test, expect } from '../fixtures/editor.fixture';

test.describe('Modals @ui', () => {
  test('settings modal opens and is visible', async ({ page, editor }) => {
    await editor.loadPage();

    // Settings button is in the sidebar (title="Settings")
    const settingsBtn = page.locator('button[title="Settings"]').first();
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();
    await page.waitForTimeout(500);

    // Settings modal has an h2 with "Settings" text
    const settingsHeading = page.locator('h2').filter({ hasText: /settings/i }).first();
    await expect(settingsHeading).toBeVisible({ timeout: 3000 });
  });

  test('settings modal has tabs', async ({ page, editor }) => {
    await editor.loadPage();

    // Open settings
    const settingsBtn = page.locator('button[title="Settings"]').first();
    await settingsBtn.click();
    await page.waitForTimeout(500);

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

  test('settings modal can be closed with X button', async ({ page, editor }) => {
    await editor.loadPage();

    // Open settings
    const settingsBtn = page.locator('button[title="Settings"]').first();
    await settingsBtn.click();
    await page.waitForTimeout(500);

    // Verify it opened
    const settingsHeading = page.locator('h2').filter({ hasText: /settings/i }).first();
    await expect(settingsHeading).toBeVisible({ timeout: 3000 });

    // Find the close button (X icon SVG button near the Settings heading)
    // The SettingsPanel has a close button with X icon in the same header row
    const closeBtn = page.locator('.fixed').filter({ hasText: /settings/i }).locator('button').filter({ has: page.locator('svg') }).first();
    await closeBtn.click();
    await page.waitForTimeout(300);

    // Modal should be gone
    await expect(settingsHeading).not.toBeVisible();
  });

  test('settings modal can be closed with Escape key', async ({ page, editor }) => {
    await editor.loadPage();

    // Open settings
    const settingsBtn = page.locator('button[title="Settings"]').first();
    await settingsBtn.click();
    await page.waitForTimeout(500);

    // Verify it opened
    const settingsHeading = page.locator('h2').filter({ hasText: /settings/i }).first();
    await expect(settingsHeading).toBeVisible({ timeout: 3000 });

    // Press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Modal should be gone
    await expect(settingsHeading).not.toBeVisible();
  });

  test('welcome modal appears on first visit', async ({ page }) => {
    // Navigate WITHOUT the fixture's loadPage() to avoid forge-welcomed suppression
    await page.goto('/dev');
    await page.waitForLoadState('networkidle');

    // Wait for React hydration (welcome modal only renders client-side)
    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__REACT_HYDRATED === true,
      { timeout: 45_000 }
    ).catch(() => {});

    // Explicitly clear the welcome flag
    await page.evaluate(() => {
      localStorage.removeItem('forge-welcomed');
    });

    // Reload to trigger first-visit experience
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__REACT_HYDRATED === true,
      { timeout: 45_000 }
    ).catch(() => {});
    await page.waitForTimeout(1000);

    // Welcome modal should be visible (fixed overlay with welcome text)
    const welcomeModal = page.locator('.fixed').filter({ hasText: /welcome|getting started/i }).first();
    const visible = await welcomeModal.isVisible().catch(() => false);
    expect(visible).toBe(true);
  });

  test('keyboard shortcuts modal opens with ? key', async ({ page, editor }) => {
    await editor.loadPage();

    // Press ? key (Shift+/)
    await page.keyboard.press('Shift+/');
    await page.waitForTimeout(500);

    // Shortcuts panel has h2 "Keyboard Shortcuts"
    const shortcutsHeading = page.locator('h2').filter({ hasText: /keyboard shortcuts/i }).first();
    await expect(shortcutsHeading).toBeVisible({ timeout: 3000 });
  });

  test('keyboard shortcuts modal can be closed with Escape', async ({ page, editor }) => {
    await editor.loadPage();

    // Open shortcuts with ? (Shift+/)
    await page.keyboard.press('Shift+/');
    await page.waitForTimeout(500);

    // Verify it opened
    const shortcutsHeading = page.locator('h2').filter({ hasText: /keyboard shortcuts/i }).first();
    await expect(shortcutsHeading).toBeVisible({ timeout: 3000 });

    // Close with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Modal should be gone
    await expect(shortcutsHeading).not.toBeVisible();
  });

  test('modals appear above other content (z-index)', async ({ page, editor }) => {
    await editor.loadPage();

    // Open settings modal
    const settingsBtn = page.locator('button[title="Settings"]').first();
    await settingsBtn.click();
    await page.waitForTimeout(500);

    // Settings modal backdrop is a fixed overlay with z-[60]
    const backdrop = page.locator('.fixed').filter({ hasText: /settings/i }).first();
    const zIndex = await backdrop.evaluate((el) => {
      return parseInt(window.getComputedStyle(el).zIndex, 10);
    });

    // Should be a high z-index (settings uses z-[60])
    expect(zIndex).toBeGreaterThan(40);
  });
});
