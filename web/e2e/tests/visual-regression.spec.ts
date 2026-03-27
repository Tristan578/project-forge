import { test, expect } from '../fixtures/editor.fixture';
import { E2E_TIMEOUT_ELEMENT_MS } from '../constants';

/**
 * PF-691: Visual regression tests using Playwright snapshot matching.
 *
 * Captures full-page and sidebar screenshots and compares them against
 * committed baseline snapshots. Tests are skipped until baseline images
 * are committed to the repository.
 *
 * To establish baselines:
 *   npx playwright test visual-regression --update-snapshots
 *
 * Tagged @ui @visual.
 */

// All tests are skipped until baseline screenshots are committed
// Enable by removing test.skip and running: npx playwright test visual-regression --update-snapshots

test.describe('Visual Regression @ui @visual', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  // skipcq: JS-0128
  test.skip('full page matches baseline snapshot', async ({ page }) => {
    // Enable after baseline screenshots are committed
    const screenshot = await page.screenshot({ fullPage: true });
    expect(screenshot).toMatchSnapshot('full-page.png');
  });

  // skipcq: JS-0128
  test.skip('sidebar matches baseline snapshot', async ({ page }) => {
    // Enable after baseline screenshots are committed
    const sidebar = page.locator('aside, [data-testid="sidebar"], .dv-dockview-container').first();
    await expect(sidebar).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    const screenshot = await sidebar.screenshot();
    expect(screenshot).toMatchSnapshot('sidebar.png');
  });
});
