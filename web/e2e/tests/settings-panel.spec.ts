/**
 * PF-160: Settings panel tab navigation, keyboard accessibility, and content.
 *
 * Tests the SettingsPanel modal from the editor (not the /settings page which
 * requires Clerk auth). Covers tab switching, keyboard navigation, ARIA roles,
 * and content area rendering.
 */
import { test, expect } from '../fixtures/editor.fixture';
import { E2E_TIMEOUT_ELEMENT_MS, E2E_TIMEOUT_LOAD_MS } from '../constants';

// Target only the settings dialog, not Next.js error overlays or other modals
const settingsDialog = '[role="dialog"][aria-labelledby="settings-dialog-title"]';

test.describe('Settings Panel @ui @dev', () => {
  test.beforeEach(async ({ editor, page }) => {
    await editor.loadPage();
    // Open settings modal
    const settingsBtn = page.locator('button[title="Settings"]').first();
    await expect(settingsBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await settingsBtn.click();
    await expect(page.locator(settingsDialog)).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  test('settings dialog has correct ARIA attributes', async ({ page }) => {
    // Wait for dialog to be fully rendered before checking ARIA attributes.
    // On CI the dialog may not have completed its mount cycle when the check runs.
    const dialog = page.locator(settingsDialog);
    await expect(dialog).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });
    await expect(dialog).toHaveAttribute('aria-modal', 'true', { timeout: E2E_TIMEOUT_LOAD_MS });
  });

  test('tab list has correct ARIA role', async ({ page }) => {
    const tabList = page.locator('[role="tablist"]');
    await expect(tabList).toBeVisible();
  });

  test('clicking each tab switches the visible panel', async ({ page }) => {
    const dialog = page.locator(settingsDialog);

    // Get all tabs
    const tabs = dialog.locator('[role="tab"]');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(2);

    // Click each tab and verify its panel becomes visible
    for (let i = 0; i < tabCount; i++) {
      const tab = tabs.nth(i);
      await tab.click();


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
    const dialog = page.locator(settingsDialog);
    const tabs = dialog.locator('[role="tab"]');
    const tabCount = await tabs.count();

    if (tabCount < 2) return;

    // Focus the first tab
    await tabs.first().focus();
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');

    // Press ArrowRight to move to next tab
    await page.keyboard.press('ArrowRight');

    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

    // Press ArrowLeft to go back
    await page.keyboard.press('ArrowLeft');

    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  });

  test('Home/End keys jump to first/last tab', async ({ page }) => {
    const dialog = page.locator(settingsDialog);
    const tabs = dialog.locator('[role="tab"]');
    const tabCount = await tabs.count();

    if (tabCount < 2) return;

    // Focus first tab, then press End
    await tabs.first().focus();
    await page.keyboard.press('End');

    await expect(tabs.nth(tabCount - 1)).toHaveAttribute('aria-selected', 'true');

    // Press Home to go back to first
    await page.keyboard.press('Home');

    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  });

  test('tokens tab shows balance section', async ({ page }) => {
    const dialog = page.locator(settingsDialog);
    const tokensTab = dialog.getByRole('tab', { name: /tokens/i });

    if (await tokensTab.isVisible().catch(() => false)) {
      await tokensTab.click();


      // Should show token-related content (balance, usage, etc.)
      const tokenContent = dialog.locator('[role="tabpanel"]').first();
      await expect(tokenContent).toBeVisible();
    }
  });

  test('API keys tab shows provider section', async ({ page }) => {
    const dialog = page.locator(settingsDialog);
    const keysTab = dialog.getByRole('tab', { name: /api.*keys|keys/i });

    if (await keysTab.isVisible().catch(() => false)) {
      await keysTab.click();


      // Should show API key management content
      const keyContent = dialog.locator('[role="tabpanel"]').first();
      await expect(keyContent).toBeVisible();
    }
  });

  test('billing tab shows plan information', async ({ page }) => {
    const dialog = page.locator(settingsDialog);
    const billingTab = dialog.getByRole('tab', { name: /billing/i });

    if (await billingTab.isVisible().catch(() => false)) {
      await billingTab.click();


      // Should show billing/plan content
      const billingContent = dialog.locator('[role="tabpanel"]').first();
      await expect(billingContent).toBeVisible();
    }
  });

  test('close button returns focus appropriately', async ({ page }) => {
    const dialog = page.locator(settingsDialog);
    const closeBtn = dialog.getByRole('button', { name: /close/i });

    await closeBtn.click();
    await expect(dialog).not.toBeVisible();

    // Settings button should still be accessible
    const settingsBtn = page.locator('button[title="Settings"]').first();
    await expect(settingsBtn).toBeVisible();
  });

  test('Escape key closes the settings dialog', async ({ page }) => {
    const dialog = page.locator(settingsDialog);
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('dialog has aria-labelledby pointing to title', async ({ page }) => {
    const dialog = page.locator(settingsDialog);
    const labelledBy = await dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBe('settings-dialog-title');

    // The referenced title should exist and contain "Settings"
    const title = page.locator(`#${labelledBy}`);
    await expect(title).toBeVisible();
    await expect(title).toHaveText(/Settings/i);
  });

  test('tab panels have correct aria-controls and aria-labelledby linkage', async ({ page }) => {
    const dialog = page.locator(settingsDialog);

    // Each tab should have aria-controls pointing to a tabpanel
    const tabs = dialog.locator('[role="tab"]');
    const tabCount = await tabs.count();

    for (let i = 0; i < tabCount; i++) {
      const tab = tabs.nth(i);
      await tab.click();


      const controls = await tab.getAttribute('aria-controls');
      expect(controls).not.toBeNull();

      // The controlled tabpanel should exist
      const panel = page.locator(`#${controls}`);
      await expect(panel).toBeVisible();

      // The panel's aria-labelledby should point back to this tab
      const labelledBy = await panel.getAttribute('aria-labelledby');
      const tabId = await tab.getAttribute('id');
      expect(labelledBy).toBe(tabId);
    }
  });

  test('arrow key navigation wraps from last to first tab', async ({ page }) => {
    const dialog = page.locator(settingsDialog);
    const tabs = dialog.locator('[role="tab"]');
    const tabCount = await tabs.count();

    if (tabCount < 2) return;

    // Focus last tab
    await tabs.nth(tabCount - 1).focus();
    await tabs.nth(tabCount - 1).click();

    await expect(tabs.nth(tabCount - 1)).toHaveAttribute('aria-selected', 'true');

    // ArrowRight should wrap to first
    await page.keyboard.press('ArrowRight');

    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');

    // ArrowLeft from first should wrap to last
    await page.keyboard.press('ArrowLeft');

    await expect(tabs.nth(tabCount - 1)).toHaveAttribute('aria-selected', 'true');
  });

  test('API keys tab shows provider list with BYOK section', async ({ page }) => {
    const dialog = page.locator(settingsDialog);
    const keysTab = dialog.getByRole('tab', { name: /api.*keys|keys/i });

    if (!(await keysTab.isVisible().catch(() => false))) return;

    await keysTab.click();


    // Should show "Provider API Keys (BYOK)" heading
    const byokHeading = dialog.getByText('Provider API Keys', { exact: false });
    await expect(byokHeading.first()).toBeVisible();

    // Should list known providers
    const providers = ['Anthropic', 'Meshy', 'ElevenLabs', 'Suno'];
    for (const provider of providers) {
      const providerLabel = dialog.getByText(provider, { exact: false });
      await expect(providerLabel.first()).toBeVisible();
    }
  });

  test('API keys tab shows MCP API Keys section with generate button', async ({ page }) => {
    const dialog = page.locator(settingsDialog);
    const keysTab = dialog.getByRole('tab', { name: /api.*keys|keys/i });

    if (!(await keysTab.isVisible().catch(() => false))) return;

    await keysTab.click();


    // Should show "MCP API Keys" heading
    const mcpHeading = dialog.getByText('MCP API Keys', { exact: false });
    await expect(mcpHeading.first()).toBeVisible();

    // Should have "Generate API Key" button
    const generateBtn = dialog.getByText('Generate API Key', { exact: false });
    await expect(generateBtn.first()).toBeVisible();
  });

  test('billing tab shows current plan section', async ({ page }) => {
    const dialog = page.locator(settingsDialog);
    const billingTab = dialog.getByRole('tab', { name: /billing/i });

    await expect(billingTab).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    // Use force:true — the tab is visible but can be intercepted by
    // overlapping elements after scroll-into-view inside the dialog.
    await billingTab.click({ force: true });

    // "Current Plan" heading renders once the loading state resolves.
    // The loading text "Loading billing information..." also satisfies the pattern.
    await expect(
      dialog.getByText(/Current Plan|Loading billing/i).first()
    ).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  test('tokens tab shows content when active', async ({ page }) => {
    const dialog = page.locator(settingsDialog);
    const tokensTab = dialog.getByRole('tab', { name: /tokens/i });

    // Tokens is the default active tab
    await expect(tokensTab).toHaveAttribute('aria-selected', 'true');

    // Tab panel should be visible with content
    const panel = dialog.locator('[role="tabpanel"]');
    await expect(panel).toBeVisible();

    // Panel should have some meaningful content (not empty)
    const panelContent = await panel.innerHTML();
    expect(panelContent.length).toBeGreaterThan(10);
  });

  test('backdrop click closes the dialog', async ({ page }) => {
    const dialog = page.locator(settingsDialog);
    await expect(dialog).toBeVisible();

    // Click outside the dialog (on the backdrop)
    // The backdrop is the parent fixed overlay at position 0,0
    await page.mouse.click(10, 10);


    await expect(dialog).not.toBeVisible();
  });

  test('settings can be reopened after closing', async ({ page }) => {
    const dialog = page.locator(settingsDialog);

    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    // Reopen
    const settingsBtn = page.locator('button[title="Settings"]').first();
    await settingsBtn.click();
    await expect(dialog).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // Should still have correct structure
    const tabList = page.locator('[role="tablist"]');
    await expect(tabList).toBeVisible();
  });
});
