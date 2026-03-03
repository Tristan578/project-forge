import { test, expect } from '@playwright/test';

test.describe('Security & Auth Flow', () => {
  test('returns secure CSP and standard security headers', async ({ request }) => {
    const response = await request.get('/');
    
    expect(response.ok()).toBeTruthy();

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
    // Attempt to access a protected route directly
    const _response = await page.goto('/dashboard');
    
    // Wait for the redirect to happen (Clerk handles this client-side or middleware)
    await page.waitForURL((url) => url.toString().includes('sign-in') || url.toString().includes('login'), { timeout: 10000 });
    
    expect(page.url()).toMatch(/sign-in|login/);
  });
});
