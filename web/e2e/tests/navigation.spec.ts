import { test, expect } from '@playwright/test';

/**
 * Navigation and routing E2E tests.
 * Verifies page routing, redirects, link navigation, and URL behavior
 * across the application.
 *
 * CI runs without Clerk keys by default. Sign-in navigation tests are
 * skipped unless valid Clerk keys (sk_/pk_ prefixes) are configured.
 * URL assertions use waitForURL (not waitForLoadState, which resolves
 * immediately on the current page and does not wait for Next.js
 * client-side navigation to complete).
 */

/**
 * Returns true when both Clerk keys are present and have valid format
 * prefixes — mirrors the validation logic in proxy.ts which requires
 * CLERK_SECRET_KEY starting with "sk_" AND
 * NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY starting with "pk_".
 */
function isClerkConfigured(): boolean {
  const secretKey = process.env.CLERK_SECRET_KEY ?? '';
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
  return secretKey.startsWith('sk_') && publishableKey.startsWith('pk_');
}

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

      // Root may redirect (302/307) or render a landing page (200).
      // 500 is only acceptable when BOTH Clerk keys are absent or do not
      // have valid sk_/pk_ prefixes (matching proxy.ts validation logic).
      const status = response?.status() ?? 0;
      const clerkConfigured = isClerkConfigured();

      if (clerkConfigured) {
        expect([200, 302, 307]).toContain(status);
      } else {
        expect([200, 302, 307, 500]).toContain(status);
      }

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
      test.skip(!isClerkConfigured(), 'Clerk not configured — requires both sk_ and pk_ keys');

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
    test('non-existent route shows not-found or redirects to sign-in', async ({ page }) => {
      const response = await page.goto('/this-route-does-not-exist-xyz');
      const status = response?.status() ?? 0;

      // When Clerk middleware is active, unknown routes that are not in
      // the public route list redirect to sign-in rather than showing a
      // 404 page. When Clerk is absent, Next.js returns 404 or a custom
      // not-found page (200).
      // Note: 302/307 redirects are accepted here only when Clerk is
      // configured — the middleware legitimately redirects protected
      // unknown routes to /sign-in. Without Clerk, no redirects are
      // expected for non-existent routes.
      if (isClerkConfigured()) {
        // Accept any valid HTTP response — Clerk may redirect to sign-in
        expect([200, 302, 307, 404]).toContain(status);

        const finalUrl = page.url();
        const redirectedToSignIn = finalUrl.includes('sign-in');

        if (!redirectedToSignIn) {
          // Route was served without a Clerk redirect — must show not-found content
          const bodyText = (await page.textContent('body')) ?? '';
          const hasNotFoundContent =
            /not\s*found|404|page.*doesn.?t\s*exist/i.test(bodyText);
          expect(hasNotFoundContent).toBe(true);
        }
      } else {
        // No Clerk middleware — Next.js returns 404 or 200 with not-found page
        expect([200, 404]).toContain(status);

        const bodyText = (await page.textContent('body')) ?? '';
        const hasNotFoundContent =
          /not\s*found|404|page.*doesn.?t\s*exist/i.test(bodyText);
        expect(hasNotFoundContent).toBe(true);
      }
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
      // Wait for the navigation to fully commit before calling goBack().
      // Without this, goBack() can race against the in-progress navigation on
      // slow CI runners and end up on an unexpected URL.
      await page.waitForURL('**/privacy**', { timeout: 10000 });
      await page.waitForLoadState('domcontentloaded');
      expect(page.url()).toContain('/privacy');

      await page.goBack();
      // Wait for back-navigation to settle before asserting the URL.
      await page.waitForURL('**/terms**', { timeout: 10000 });
      await page.waitForLoadState('domcontentloaded');
      expect(page.url()).toContain('/terms');
    });
  });
});
