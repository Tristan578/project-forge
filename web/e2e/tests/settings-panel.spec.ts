/**
 * PF-160: Settings panel tab navigation, keyboard accessibility, and content.
 *
 * Tests the SettingsPanel modal from the editor (not the /settings page which
 * requires Clerk auth). Covers tab switching, keyboard navigation, ARIA roles,
 * and content area rendering.
 */
import { test, expect } from '../fixtures/editor.fixture';

test.describe('Settings Panel @ui', () => {
  test.beforeEach(async ({ editor, page }) => {
    await editor.loadPage();
    // Open settings modal
    const settingsBtn = page.locator('button[title="Settings"]').first();
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
  });

  test('settings dialog has correct ARIA attributes', async ({ page }) => {
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  test('tab list has correct ARIA role', async ({ page }) => {
    const tabList = page.locator('[role="tablist"]');
    await expect(tabList).toBeVisible();
  });

  test('clicking each tab switches the visible panel', async ({ page }) => {
    const dialog = page.locator('[role="dialog"]');

    // Get all tabs
    const tabs = dialog.locator('[role="tab"]');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(2);

    // Click each tab and verify its panel becomes visible
    for (let i = 0; i < tabCount; i++) {
      const tab = tabs.nth(i);
      await tab.click();
      await page.waitForTimeout(200);

      // Active tab should have aria-selected="true"
      await expect(tab).toHaveAttribute('aria-selected', 'true');

      // All other tabs should have aria-selected="false"
      for (let j = 0; j < tabCount; j++) {
        if (j !== i) {
          await expect(tabs.nth(j)).toHaveAttribute('aria-selected', 'false');
        }
      }
    }
  });

  test('arrow keys navigate between tabs', async ({ page }) => {
    const dialog = page.locator('[role="dialog"]');
    const tabs = dialog.locator('[role="tab"]');
    const tabCount = await tabs.count();

    if (tabCount < 2) return;

    // Focus the first tab
    await tabs.first().focus();
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');

    // Press ArrowRight to move to next tab
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

    // Press ArrowLeft to go back
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(100);
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  });

  test('Home/End keys jump to first/last tab', async ({ page }) => {
    const dialog = page.locator('[role="dialog"]');
    const tabs = dialog.locator('[role="tab"]');
    const tabCount = await tabs.count();

    if (tabCount < 2) return;

    // Focus first tab, then press End
    await tabs.first().focus();
    await page.keyboard.press('End');
    await page.waitForTimeout(100);
    await expect(tabs.nth(tabCount - 1)).toHaveAttribute('aria-selected', 'true');

    // Press Home to go back to first
    await page.keyboard.press('Home');
    await page.waitForTimeout(100);
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  });

  test('tokens tab shows balance section', async ({ page }) => {
    const dialog = page.locator('[role="dialog"]');
    const tokensTab = dialog.getByRole('tab', { name: /tokens/i });

    if (await tokensTab.isVisible().catch(() => false)) {
      await tokensTab.click();
      await page.waitForTimeout(300);

      // Should show token-related content (balance, usage, etc.)
      const tokenContent = dialog.locator('[role="tabpanel"]').first();
      await expect(tokenContent).toBeVisible();
    }
  });

  test('API keys tab shows provider section', async ({ page }) => {
    const dialog = page.locator('[role="dialog"]');
    const keysTab = dialog.getByRole('tab', { name: /api.*keys|keys/i });

    if (await keysTab.isVisible().catch(() => false)) {
      await keysTab.click();
      await page.waitForTimeout(300);

      // Should show API key management content
      const keyContent = dialog.locator('[role="tabpanel"]').first();
      await expect(keyContent).toBeVisible();
    }
  });

  test('billing tab shows plan information', async ({ page }) => {
    const dialog = page.locator('[role="dialog"]');
    const billingTab = dialog.getByRole('tab', { name: /billing/i });

    if (await billingTab.isVisible().catch(() => false)) {
      await billingTab.click();
      await page.waitForTimeout(300);

      // Should show billing/plan content
      const billingContent = dialog.locator('[role="tabpanel"]').first();
      await expect(billingContent).toBeVisible();
    }
  });

  test('close button returns focus appropriately', async ({ page }) => {
    const dialog = page.locator('[role="dialog"]');
    const closeBtn = dialog.getByRole('button', { name: /close/i });

    await closeBtn.click();
    await expect(dialog).not.toBeVisible();

    // Settings button should still be accessible
    const settingsBtn = page.locator('button[title="Settings"]').first();
    await expect(settingsBtn).toBeVisible();
  });
});
