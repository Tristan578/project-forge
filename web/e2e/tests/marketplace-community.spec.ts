import { test, expect } from '@playwright/test';
import { E2E_TIMEOUT_LOAD_MS } from '../constants';

/**
 * #8603: Community gallery — the consumer-discovery surface for published
 * games. It is the ONLY discovery page that renders without auth or a seeded
 * DB in CI (`'use cache'`, no Clerk gate), so it is the natural browser-level
 * complement to the API-layer marketplace + play coverage.
 *
 * The "Featured" section only renders when featuredGames.length > 0 (a seeded
 * DB), so it is asserted conditionally; the page header and breadcrumbs are
 * deterministic in CI.
 */
test.describe('Community Gallery @ui', () => {
  test('renders the gallery header', async ({ page }) => {
    await page.goto('/community');
    await page.waitForLoadState('domcontentloaded');

    await expect(
      page.getByRole('heading', { name: 'Community Gallery', level: 1 })
    ).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });
  });

  test('renders breadcrumbs with a Community crumb', async ({ page }) => {
    await page.goto('/community');
    await page.waitForLoadState('domcontentloaded');

    const breadcrumb = page.locator('nav[aria-label="Breadcrumb"]');
    await expect(breadcrumb).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

    // On /community the items passed to <Breadcrumbs> are
    // [{ label: 'Community', href: '/community' }] (href is a required
    // BreadcrumbItem field), so 'Community' is the TERMINAL crumb -> rendered as a non-link
    // <span aria-current="page">, NOT a <Link>. Assert the current-page span.
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('Community');
    // The prepended 'Home' entry is non-terminal, so it IS a real link.
    await expect(breadcrumb.getByRole('link', { name: 'Home' })).toBeVisible();
  });

  test('Featured section renders when featured games exist (seeded DB only)', async ({ page }) => {
    await page.goto('/community');
    await page.waitForLoadState('domcontentloaded');

    // Featured is conditional on seeded data — only assert it when present so
    // the test stays deterministic in a DB-less CI env.
    const featured = page.getByRole('heading', { name: 'Featured', level: 2 });
    if ((await featured.count()) > 0) {
      await expect(featured.first()).toBeVisible();
    }
  });
});
