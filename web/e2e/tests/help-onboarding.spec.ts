import { test, expect } from '../fixtures/editor.fixture';

/**
 * Help menu and onboarding flow tests.
 * Verifies the help dropdown, keyboard shortcuts modal, welcome modal,
 * and getting-started checklist work correctly.
 */
test.describe('Help & Onboarding @ui', () => {
  test.describe('Help Menu', () => {
    test.beforeEach(async ({ editor }) => {
      await editor.loadPage();
    });

    test('help menu button is visible in toolbar', async ({ page }) => {
      const helpBtn = page.locator('button[aria-label="Help menu"]').first();
      await expect(helpBtn).toBeVisible({ timeout: 5000 });
    });

    test('help menu opens with menu items', async ({ page }) => {
      const helpBtn = page.locator('button[aria-label="Help menu"]').first();
      await helpBtn.click();

      // Should show menu items
      const menuItems = page.getByRole('menuitem');
      expect(await menuItems.count()).toBeGreaterThan(0);
    });

    test('keyboard shortcuts item opens shortcuts modal', async ({ page }) => {
      const helpBtn = page.locator('button[aria-label="Help menu"]').first();
      await helpBtn.click();

      const shortcutsItem = page.getByRole('menuitem', { name: /keyboard shortcuts/i });
      await expect(shortcutsItem).toBeVisible({ timeout: 3000 });
      await shortcutsItem.click();

      // Shortcuts modal should be visible with heading
      const heading = page.locator('h2').filter({ hasText: /keyboard shortcuts/i }).first();
      await expect(heading).toBeVisible({ timeout: 5000 });
    });

    test('shortcuts modal lists shortcut categories', async ({ page }) => {
      // Open shortcuts modal
      const helpBtn = page.locator('button[aria-label="Help menu"]').first();
      await helpBtn.click();
      await page.getByRole('menuitem', { name: /keyboard shortcuts/i }).click();

      // Should have some shortcut descriptions visible
      const shortcutKeys = page.locator('kbd, [class*="shortcut"], [class*="key"]');
      const count = await shortcutKeys.count();
      expect(count).toBeGreaterThan(0);
    });

    test('help menu closes when clicking outside', async ({ page }) => {
      const helpBtn = page.locator('button[aria-label="Help menu"]').first();
      await helpBtn.click();

      // Menu should be visible
      const menuItems = page.getByRole('menuitem');
      expect(await menuItems.count()).toBeGreaterThan(0);

      // Click outside (on the canvas or body)
      await page.mouse.click(10, 10);

      // Menu should close (items should not be visible)
      await expect(menuItems.first()).not.toBeVisible({ timeout: 3000 });
    });
  });

  test.describe('Onboarding Flow', () => {
    test('onboarding appears on first visit', async ({ page }) => {
      // Skip engine loading, do NOT set forge-quickstart-completed or forge-welcomed
      await page.addInitScript(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__SKIP_ENGINE = true;
        localStorage.setItem('forge-checklist-dismissed', '1');
        localStorage.setItem('forge-mobile-dismissed', '1');
      });

      await page.goto('/dev');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 30_000 },
      );

      // QuickStartFlow or WelcomeModal should appear (fixed overlay)
      const onboardingOverlay = page.locator('.fixed').filter({ hasText: /what kind of game|welcome|getting started/i }).first();
      await expect(onboardingOverlay).toBeVisible({ timeout: 5000 });
    });

    test('onboarding does not appear when already completed', async ({ page }) => {
      await page.addInitScript(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__SKIP_ENGINE = true;
        localStorage.setItem('forge-quickstart-completed', '1');
        localStorage.setItem('forge-welcomed', '1');
        localStorage.setItem('forge-checklist-dismissed', '1');
        localStorage.setItem('forge-mobile-dismissed', '1');
      });

      await page.goto('/dev');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__REACT_HYDRATED === true,
        { timeout: 30_000 },
      );

      // Wait a moment for modal to potentially appear
      await page.waitForTimeout(2000);

      // No onboarding overlay should appear
      const onboardingOverlay = page.locator('.fixed').filter({ hasText: /what kind of game|welcome|getting started/i }).first();
      const visible = await onboardingOverlay.isVisible().catch(() => false);
      expect(visible).toBe(false);
    });
  });

  test.describe('Editor Tooltips', () => {
    test.beforeEach(async ({ editor }) => {
      await editor.loadPage();
    });

    test('sidebar buttons have title tooltips', async ({ page }) => {
      const buttonsWithTitles = page.locator('button[title]');
      const count = await buttonsWithTitles.count();
      expect(count).toBeGreaterThan(5);
    });

    test('transform tool buttons have descriptive titles', async ({ page }) => {
      const expectedTitles = ['Select', 'Translate (W)', 'Rotate (E)', 'Scale (R)'];

      for (const title of expectedTitles) {
        const btn = page.locator(`button[title="${title}"]`).first();
        if (await btn.count() > 0) {
          await expect(btn).toBeVisible();
        }
      }

      // At least some transform buttons should exist
      const transformBtns = page.locator(
        'button[title*="Translate"], button[title*="Rotate"], button[title*="Scale"]',
      );
      expect(await transformBtns.count()).toBeGreaterThan(0);
    });

    test('settings button has correct title', async ({ page }) => {
      const settingsBtn = page.locator('button[title="Settings"]').first();
      await expect(settingsBtn).toBeVisible();
    });
  });
});
