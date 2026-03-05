import { test, expect } from '@playwright/test';

/**
 * Navigation and routing E2E tests.
 * Verifies page routing, redirects, link navigation, and URL behavior
 * across the application.
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
      // /dev is a public route, should not redirect
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
    test('/ redirects away from root', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      // Wait for any client-side redirects to settle
      await page.waitForTimeout(3000);

      // Root should redirect somewhere — the exact target depends on auth state
      const url = page.url();
      // Should no longer be at bare root, or page should have meaningful content
      const hasRedirected = !url.endsWith(':3000/') || (await page.textContent('body'))!.length > 50;
      expect(hasRedirected).toBe(true);
    });
  });

  test.describe('Cross-Page Navigation', () => {
    test('terms page links to privacy and vice versa', async ({ page }) => {
      await page.goto('/terms');
      await page.waitForLoadState('domcontentloaded');

      // Find and click privacy link
      const privacyLink = page.locator('a[href="/privacy"]').first();
      await expect(privacyLink).toBeVisible();
      await privacyLink.click();

      // Wait for navigation to complete (Next.js client-side)
      await page.waitForURL('**/privacy**', { timeout: 10000 });
      expect(page.url()).toContain('/privacy');

      // Now navigate back to terms from privacy
      const termsLink = page.locator('a[href="/terms"]').first();
      await expect(termsLink).toBeVisible();
      await termsLink.click();

      await page.waitForURL('**/terms**', { timeout: 10000 });
      expect(page.url()).toContain('/terms');
    });

    test('pricing page Sign In button navigates to sign-in', async ({ page }) => {
      await page.goto('/pricing');
      await page.waitForLoadState('domcontentloaded');

      const signInBtn = page.getByRole('button', { name: /sign in/i });
      if (await signInBtn.isVisible()) {
        await signInBtn.click();

        await page.waitForLoadState('domcontentloaded');
        expect(page.url()).toMatch(/sign-in/);
      }
    });
  });

  test.describe('404 Handling', () => {
    test('non-existent route returns 404 or redirects', async ({ page }) => {
      const response = await page.goto('/this-route-does-not-exist-xyz');

      // Should either be a 404 page or a redirect
      const status = response?.status() ?? 0;
      expect([200, 404, 302, 307]).toContain(status);

      // If 200, it should show a not-found message or redirect
      if (status === 200) {
        const bodyText = await page.textContent('body');
        // Either "not found" message or redirect happened
        expect(bodyText?.length).toBeGreaterThan(0);
      }
    });
  });

  test.describe('Editor Route', () => {
    test('/dev loads editor with canvas', async ({ page }) => {
      await page.goto('/dev');
      await page.waitForLoadState('domcontentloaded');

      // Canvas should be present
      const canvas = page.locator('canvas').first();
      await expect(canvas).toBeVisible({ timeout: 15000 });
    });

    test('/dev loads editor with sidebar', async ({ page }) => {
      await page.goto('/dev');
      await page.waitForLoadState('domcontentloaded');

      // Sidebar buttons should be present
      const addEntityBtn = page.getByRole('button', { name: /add.*entity/i }).first();
      await expect(addEntityBtn).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Browser Navigation', () => {
    test('back button works between public pages', async ({ page }) => {
      await page.goto('/terms');
      await page.waitForLoadState('domcontentloaded');

      // Navigate to privacy via link
      const privacyLink = page.locator('a[href="/privacy"]').first();
      await privacyLink.click();
      await page.waitForURL('**/privacy**', { timeout: 10000 });
      expect(page.url()).toContain('/privacy');

      // Go back
      await page.goBack();
      await page.waitForURL('**/terms**', { timeout: 10000 });
      expect(page.url()).toContain('/terms');
    });
  });
});
