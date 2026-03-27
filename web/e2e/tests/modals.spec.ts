import { test, expect } from '../fixtures/editor.fixture';
import { E2E_TIMEOUT_ELEMENT_MS, E2E_TIMEOUT_LOAD_MS, E2E_TIMEOUT_AUTH_MS } from '../constants';

test.describe('Modals @ui', () => {
  test('settings modal opens and is visible', async ({ page, editor }) => {
    await editor.loadPage();

    const settingsBtn = page.locator('button[title="Settings"]').first();
    await expect(settingsBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await settingsBtn.click();

    const dialog = page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]');
    await expect(dialog).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  test('settings modal has tabs', async ({ page, editor }) => {
    await editor.loadPage();

    const settingsBtn = page.locator('button[title="Settings"]').first();
    await settingsBtn.click();

    const dialog = page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]');
    await expect(dialog).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    const tokensTab = dialog.getByRole('tab', { name: /tokens/i });
    const keysTab = dialog.getByRole('tab', { name: /api.*keys|keys/i });
    const billingTab = dialog.getByRole('tab', { name: /billing/i });

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

    const dialog = page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]');
    await expect(dialog).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    const closeBtn = dialog.getByRole('button', { name: /close/i });
    await closeBtn.click();

    await expect(dialog).not.toBeVisible();
  });

  test('settings modal can be closed with Escape key', async ({ page, editor }) => {
    await editor.loadPage();

    const settingsBtn = page.locator('button[title="Settings"]').first();
    await settingsBtn.click();

    const dialog = page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]');
    await expect(dialog).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    await page.keyboard.press('Escape');

    await expect(dialog).not.toBeVisible();
  });

  test('onboarding flow appears on first visit', async ({ page }) => {
    // Skip engine loading (prevents browser crash without WASM assets)
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__SKIP_ENGINE = true;
      // Do NOT set forge-quickstart-completed or forge-welcomed — first visit
      localStorage.setItem('forge-checklist-dismissed', '1');
      localStorage.setItem('forge-mobile-dismissed', '1');
    });

    await page.goto('/dev');
    await page.waitForLoadState('domcontentloaded');
    // Wait for React hydration (onboarding only renders client-side)
    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__REACT_HYDRATED === true,
      { timeout: E2E_TIMEOUT_AUTH_MS }
    );

    // QuickStartFlow or WelcomeModal should be visible (fixed overlay)
    const onboardingOverlay = page.locator('.fixed').filter({ hasText: /what kind of game|welcome|getting started/i }).first();
    await expect(onboardingOverlay).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  test('keyboard shortcuts modal opens via Help menu', async ({ page, editor }) => {
    await editor.loadPage();

    // Open the Help dropdown menu
    const helpBtn = page.locator('button[aria-label="Help menu"]').first();
    await expect(helpBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await helpBtn.click();

    // Click "Keyboard Shortcuts" menu item
    const shortcutsItem = page.getByRole('menuitem', { name: /keyboard shortcuts/i });
    await expect(shortcutsItem).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await shortcutsItem.click();

    const shortcutsHeading = page.locator('h2').filter({ hasText: /keyboard shortcuts/i }).first();
    await expect(shortcutsHeading).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  test('keyboard shortcuts modal can be closed with Escape', async ({ page, editor }) => {
    await editor.loadPage();

    // Open the Help dropdown menu, then Keyboard Shortcuts
    const helpBtn = page.locator('button[aria-label="Help menu"]').first();
    await helpBtn.click();
    const shortcutsItem = page.getByRole('menuitem', { name: /keyboard shortcuts/i });
    await shortcutsItem.click();

    const shortcutsHeading = page.locator('h2').filter({ hasText: /keyboard shortcuts/i }).first();
    await expect(shortcutsHeading).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    await page.keyboard.press('Escape');

    await expect(shortcutsHeading).not.toBeVisible();
  });

  // fixme: CSS transition timing causes intermittent getComputedStyle failures on CI
  test.fixme('modals appear above other content (z-index)', async ({ page, editor }) => {
    await editor.loadPage();

    const settingsBtn = page.locator('button[title="Settings"]').first();
    await settingsBtn.click();

    // Wait for dialog to be fully visible and rendered before measuring z-index.
    // On CI the modal may still be transitioning into position when the check runs.
    await page.waitForSelector('[role="dialog"][aria-labelledby="settings-dialog-title"]', {
      state: 'visible',
      timeout: E2E_TIMEOUT_LOAD_MS,
    });

    const dialog = page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]');
    await expect(dialog).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // Settings modal backdrop is a fixed overlay with z-[60]
    const backdrop = page.locator('.fixed').filter({ hasText: /settings/i }).first();
    const zIndex = await backdrop.evaluate((el) => {
      return parseInt(window.getComputedStyle(el).zIndex, 10);
    });

    expect(zIndex).toBeGreaterThan(40);
  });
});
