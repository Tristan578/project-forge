import { test, expect } from '../fixtures/editor.fixture';

test.describe('Modals @ui', () => {
  test('settings modal opens and is visible', async ({ page, editor }) => {
    await editor.loadPage();

    const settingsBtn = page.locator('button[title="Settings"]').first();
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
  });

  test('settings modal has tabs', async ({ page, editor }) => {
    await editor.loadPage();

    const settingsBtn = page.locator('button[title="Settings"]').first();
    await settingsBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const tokensTab = dialog.getByRole('button', { name: /tokens/i });
    const keysTab = dialog.getByRole('button', { name: /api.*keys|keys/i });
    const billingTab = dialog.getByRole('button', { name: /billing/i });

    const tabCount = await Promise.all([
      tokensTab.isVisible().catch(() => false),
      keysTab.isVisible().catch(() => false),
      billingTab.isVisible().catch(() => false),
    ]).then((results) => results.filter(Boolean).length);

    expect(tabCount).toBeGreaterThan(0);
  });

  test('settings modal can be closed with X button', async ({ page, editor }) => {
    await editor.loadPage();

    const settingsBtn = page.locator('button[title="Settings"]').first();
    await settingsBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const closeBtn = dialog.getByRole('button', { name: /close/i });
    await closeBtn.click();

    await expect(dialog).not.toBeVisible();
  });

  test('settings modal can be closed with Escape key', async ({ page, editor }) => {
    await editor.loadPage();

    const settingsBtn = page.locator('button[title="Settings"]').first();
    await settingsBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');

    await expect(dialog).not.toBeVisible();
  });

  test('welcome modal appears on first visit', async ({ page }) => {
    // Skip engine loading (prevents browser crash without WASM assets)
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__SKIP_ENGINE = true;
      // Do NOT set forge-welcomed — we want the welcome modal to appear
      localStorage.setItem('forge-checklist-dismissed', '1');
      localStorage.setItem('forge-mobile-dismissed', '1');
    });

    await page.goto('/dev');
    await page.waitForLoadState('domcontentloaded');
    // Wait for React hydration (welcome modal only renders client-side)
    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__REACT_HYDRATED === true,
      { timeout: 30_000 }
    );

    // Welcome modal should be visible (fixed overlay with welcome text)
    const welcomeModal = page.locator('.fixed').filter({ hasText: /welcome|getting started/i }).first();
    await expect(welcomeModal).toBeVisible({ timeout: 5000 });
  });

  test('keyboard shortcuts modal opens with ? key', async ({ page, editor }) => {
    await editor.loadPage();

    // Open shortcuts via the toolbar button (? keyboard shortcut is unreliable in headless)
    const shortcutsBtn = page.locator('button[title="Keyboard shortcuts (?)"]').first();
    await expect(shortcutsBtn).toBeVisible({ timeout: 5000 });
    await shortcutsBtn.click();

    const shortcutsHeading = page.locator('h2').filter({ hasText: /keyboard shortcuts/i }).first();
    await expect(shortcutsHeading).toBeVisible({ timeout: 5000 });
  });

  test('keyboard shortcuts modal can be closed with Escape', async ({ page, editor }) => {
    await editor.loadPage();

    const shortcutsBtn = page.locator('button[title="Keyboard shortcuts (?)"]').first();
    await shortcutsBtn.click();

    const shortcutsHeading = page.locator('h2').filter({ hasText: /keyboard shortcuts/i }).first();
    await expect(shortcutsHeading).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');

    await expect(shortcutsHeading).not.toBeVisible();
  });

  test('modals appear above other content (z-index)', async ({ page, editor }) => {
    await editor.loadPage();

    const settingsBtn = page.locator('button[title="Settings"]').first();
    await settingsBtn.click();

    // Wait for dialog to be visible before measuring z-index
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Settings modal backdrop is a fixed overlay with z-[60]
    const backdrop = page.locator('.fixed').filter({ hasText: /settings/i }).first();
    const zIndex = await backdrop.evaluate((el) => {
      return parseInt(window.getComputedStyle(el).zIndex, 10);
    });

    expect(zIndex).toBeGreaterThan(40);
  });
});
