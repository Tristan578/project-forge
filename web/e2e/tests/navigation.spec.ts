import { test, expect } from '@playwright/test';

/**
 * Navigation and routing E2E tests.
 * Verifies page routing, redirects, link navigation, and URL behavior
 * across the application.
 *
 * Clerk keys are configured in CI. Sign-in navigation tests verify the
 * URL change via waitForURL (not waitForLoadState, which doesn't wait
 * for Next.js client-side navigation to complete).
 */
test.describe('Navigation & Routing @ui', () => {
  test.describe('Public Route Access', () => {
    test('/pricing loads without redirect', async ({ page }) => {
      const response = await page.goto('/pricing');
      expect(response?.status()).toBe(200);
      expect(page.url()).toContain('/pricing');
    });

    test('/terms loads without redirect', async ({ page }) => {
      const response = await page.goto('/terms');
      expect(response?.status()).toBe(200);
      expect(page.url()).toContain('/terms');
    });

    test('/privacy loads without redirect', async ({ page }) => {
      const response = await page.goto('/privacy');
      expect(response?.status()).toBe(200);
      expect(page.url()).toContain('/privacy');
    });

    test('/dev loads without redirect', async ({ page }) => {
      const response = await page.goto('/dev');
      expect(response?.status()).toBe(200);
      expect(page.url()).toContain('/dev');
    });

    test('/api-docs loads without redirect', async ({ page }) => {
      const response = await page.goto('/api-docs');
      expect(response?.status()).toBe(200);
      expect(page.url()).toContain('/api-docs');
    });

    test('/community loads without redirect', async ({ page }) => {
      const response = await page.goto('/community');
      expect(response?.status()).toBe(200);
      expect(page.url()).toContain('/community');
    });
  });

  test.describe('Root Route Redirect', () => {
    test('/ redirects or renders meaningful content', async ({ page }) => {
      const response = await page.goto('/', { waitUntil: 'domcontentloaded' });

      // Root should either redirect (302/307) or render a landing page (200).
      const status = response?.status() ?? 0;
      expect([200, 302, 307]).toContain(status);

      if (status === 200) {
        // If it rendered (not redirected), page must have meaningful content
        const bodyText = await page.textContent('body');
        expect(bodyText!.length).toBeGreaterThan(50);
      }
    });
  });

  test.describe('Cross-Page Navigation', () => {
    test('terms page links to privacy and vice versa', async ({ page }) => {
      await page.goto('/terms');
      await page.waitForLoadState('domcontentloaded');

      const privacyLink = page.locator('a[href="/privacy"]').first();
      await expect(privacyLink).toBeVisible();
      await privacyLink.click();

      await page.waitForURL('**/privacy**', { timeout: 10000 });
      expect(page.url()).toContain('/privacy');

      const termsLink = page.locator('a[href="/terms"]').first();
      await expect(termsLink).toBeVisible();
      await termsLink.click();

      await page.waitForURL('**/terms**', { timeout: 10000 });
      expect(page.url()).toContain('/terms');
    });

    test('pricing page Sign In button navigates to sign-in', async ({ page }) => {
      test.skip(!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, 'Clerk not configured');

      await page.goto('/pricing');
      await page.waitForLoadState('domcontentloaded');

      const signInBtn = page.getByRole('button', { name: /sign in/i });

      // When signed out, the Sign In button should be visible
      await expect(signInBtn).toBeVisible({ timeout: 5000 });

      await signInBtn.click();

      // The button calls router.push('/sign-in'). Use waitForURL instead
      // of waitForLoadState — the latter resolves immediately on the
      // current page and doesn't wait for Next.js client-side navigation.
      await page.waitForURL('**/sign-in**', { timeout: 10000 });
      expect(page.url()).toMatch(/sign-in/);
    });
  });

  test.describe('404 Handling', () => {
    test('non-existent route shows not-found content', async ({ page }) => {
      const response = await page.goto('/this-route-does-not-exist-xyz');
      const status = response?.status() ?? 0;

      // Next.js returns 404 for unknown routes, or 200 with a custom not-found page
      expect([200, 404]).toContain(status);

      // Page should render recognisable not-found content
      const bodyText = (await page.textContent('body')) ?? '';
      const hasNotFoundContent =
        /not\s*found|404|page.*doesn.?t\s*exist/i.test(bodyText);
      expect(hasNotFoundContent).toBe(true);
    });
  });

  test.describe('Editor Route', () => {
    test('/dev loads editor with canvas', async ({ page }) => {
      await page.goto('/dev');
      await page.waitForLoadState('domcontentloaded');

      const canvas = page.locator('canvas').first();
      await expect(canvas).toBeVisible({ timeout: 15000 });
    });

    test('/dev loads editor with sidebar', async ({ page }) => {
      await page.goto('/dev');
      await page.waitForLoadState('domcontentloaded');

      const addEntityBtn = page.getByRole('button', { name: /add.*entity/i }).first();
      await expect(addEntityBtn).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Browser Navigation', () => {
    test('back button works between public pages', async ({ page }) => {
      await page.goto('/terms');
      await page.waitForLoadState('domcontentloaded');

      const privacyLink = page.locator('a[href="/privacy"]').first();
      await privacyLink.click();
      await page.waitForURL('**/privacy**', { timeout: 10000 });
      expect(page.url()).toContain('/privacy');

      await page.goBack();
      await page.waitForURL('**/terms**', { timeout: 10000 });
      expect(page.url()).toContain('/terms');
    });
  });
});
