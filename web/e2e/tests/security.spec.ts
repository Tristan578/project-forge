import { test, expect } from '@playwright/test';

test.describe('Security & Auth Flow', () => {
  test('returns secure CSP and standard security headers', async ({ request }) => {
    // Hit a route that works regardless of Clerk configuration.
    // next.config.ts applies security headers to /:path* at the server level,
    // so they are present on every response — even non-200 ones.
    const response = await request.get('/api/health');

    const headers = response.headers();

    // Check Content-Security-Policy (set by next.config.ts, not by Clerk)
    expect(headers).toHaveProperty('content-security-policy');
    const csp = headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");

    // Check other security headers
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['x-xss-protection']).toBe('1; mode=block');
    expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
  });

  test('redirects unauthenticated users from protected routes to login', async ({ page }) => {
    // This test verifies Clerk middleware auth protection.
    // proxy.ts intentionally falls back to passthrough when Clerk keys are
    // missing (forks, local dev without .env), so skip when that's the case.
    const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
    test.skip(
      !clerkKey.startsWith('pk_test_') && !clerkKey.startsWith('pk_live_'),
      'Clerk publishable key not configured — auth redirect requires active Clerk middleware',
    );

    // Attempt to access a protected route directly
    const _response = await page.goto('/dashboard');

    // Clerk middleware intercepts and redirects unauthenticated users
    await page.waitForURL(
      (url) => url.toString().includes('sign-in') || url.toString().includes('login'),
      { timeout: 30000 },
    );

    expect(page.url()).toMatch(/sign-in|login/);
  });
});
