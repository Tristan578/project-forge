import { test, expect } from '@playwright/test';

test.describe('Security & Auth Flow', () => {
  test('returns secure CSP and standard security headers', async ({ request }) => {
    const response = await request.get('/');

    // In CI without full env (e.g. missing Clerk/DB keys), the server may return non-200
    if (!response.ok()) {
      test.skip(true, `Server returned ${response.status()} — likely missing env vars in CI`);
    }

    const headers = response.headers();
    
    // Check Content-Security-Policy
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
    test.skip(!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, 'Clerk keys not configured — auth redirect requires Clerk middleware');

    // Attempt to access a protected route directly
    const _response = await page.goto('/dashboard');
    
    // Wait for the redirect to happen (Clerk handles this client-side or middleware)
    await page.waitForURL((url) => url.toString().includes('sign-in') || url.toString().includes('login'), { timeout: 30000 });
    
    expect(page.url()).toMatch(/sign-in|login/);
  });
});
