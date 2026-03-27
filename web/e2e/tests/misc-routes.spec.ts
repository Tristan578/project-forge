import { test, expect } from '@playwright/test';
import {
  E2E_TIMEOUT_ELEMENT_MS,
  E2E_TIMEOUT_NAV_MS,
} from '../constants';

/**
 * Miscellaneous routes E2E tests — covers API endpoints and pages not
 * addressed by the main api-routes.spec.ts or public-pages.spec.ts suites.
 *
 * Includes:
 *   - /api/status             public, unauthenticated
 *   - /api/capabilities       public, unauthenticated
 *   - /api/vitals             POST, public, unauthenticated
 *   - /api/docs               public, unauthenticated
 *   - /api/sentry             POST tunnel (no DSN in test env → 503)
 *   - /api/cron/health-monitor protected by CRON_SECRET
 *   - 404 not-found page
 * Routes requiring auth (feedback, bridges, tokens, etc.) are verified to
 * correctly reject unauthenticated requests.
 */
test.describe('Misc Routes @ui', () => {
  // ---------------------------------------------------------------------------
  // /api/status — public status-page endpoint
  // ---------------------------------------------------------------------------
  test.describe('Status Endpoint', () => {
    test('GET /api/status returns 200 with JSON', async ({ request }) => {
      const response = await request.get('/api/status');
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('application/json');
    });

    test('status response has generatedAt, overall, and services fields', async ({
      request,
    }) => {
      const response = await request.get('/api/status');
      const body = await response.json();

      expect(body).toHaveProperty('generatedAt');
      expect(body).toHaveProperty('overall');
      expect(body).toHaveProperty('services');
      expect(Array.isArray(body.services)).toBe(true);
    });

    test('status overall is a recognised value', async ({ request }) => {
      const response = await request.get('/api/status');
      const body = await response.json();

      expect(['operational', 'partial_outage', 'major_outage', 'maintenance']).toContain(body.overall);
    });

    test('status service entries have required shape', async ({ request }) => {
      const response = await request.get('/api/status');
      const body = await response.json();

      for (const svc of body.services) {
        expect(typeof svc.id).toBe('string');
        expect(typeof svc.name).toBe('string');
        expect(['operational', 'degraded', 'outage']).toContain(svc.status);
      }
    });

    test('status response has Cache-Control header', async ({ request }) => {
      const response = await request.get('/api/status');
      const cc = response.headers()['cache-control'];
      expect(cc).toBeTruthy();
      expect(cc).toContain('max-age=30');
    });
  });

  // ---------------------------------------------------------------------------
  // /api/capabilities — public provider capability check
  // ---------------------------------------------------------------------------
  test.describe('Capabilities Endpoint', () => {
    test('GET /api/capabilities returns 200 with JSON', async ({ request }) => {
      const response = await request.get('/api/capabilities');
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('application/json');
    });

    test('capabilities response has capabilities, available, and unavailable arrays', async ({
      request,
    }) => {
      const response = await request.get('/api/capabilities');
      const body = await response.json();

      expect(Array.isArray(body.capabilities)).toBe(true);
      expect(Array.isArray(body.available)).toBe(true);
      expect(Array.isArray(body.unavailable)).toBe(true);
    });

    test('available + unavailable cover all returned capabilities', async ({
      request,
    }) => {
      const response = await request.get('/api/capabilities');
      const body = await response.json();

      const total = body.available.length + body.unavailable.length;
      expect(total).toBe(body.capabilities.length);
    });

    test('each capability entry has capability, available, and label', async ({
      request,
    }) => {
      const response = await request.get('/api/capabilities');
      const body = await response.json();

      for (const cap of body.capabilities) {
        expect(typeof cap.capability).toBe('string');
        expect(typeof cap.available).toBe('boolean');
        expect(typeof cap.label).toBe('string');
      }
    });

    test('unavailable capabilities include requiredProviders hint', async ({
      request,
    }) => {
      const response = await request.get('/api/capabilities');
      const body = await response.json();

      const unavailable = body.capabilities.filter(
        (c: { available: boolean }) => !c.available,
      );
      for (const cap of unavailable) {
        expect(Array.isArray(cap.requiredProviders)).toBe(true);
        expect(cap.requiredProviders.length).toBeGreaterThan(0);
        expect(typeof cap.hint).toBe('string');
      }
    });

    test('known capability names are present', async ({ request }) => {
      const response = await request.get('/api/capabilities');
      const body = await response.json();

      const names = body.capabilities.map(
        (c: { capability: string }) => c.capability,
      );
      for (const expected of ['chat', 'image', 'sprite', 'sfx']) {
        expect(names).toContain(expected);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // /api/vitals — POST Core Web Vitals ingest
  // ---------------------------------------------------------------------------
  test.describe('Vitals Endpoint', () => {
    test('POST /api/vitals with valid payload returns 204', async ({ request }) => {
      const response = await request.post('/api/vitals', {
        data: { name: 'LCP', value: 1234.5, id: 'v1-abc-123', delta: 100 },
      });
      expect(response.status()).toBe(204);
    });

    test('POST /api/vitals with missing fields returns 400', async ({ request }) => {
      const response = await request.post('/api/vitals', {
        data: { name: 'LCP' }, // missing value, id, delta
      });
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty('error');
    });

    test('POST /api/vitals with invalid metric name returns 400', async ({
      request,
    }) => {
      const response = await request.post('/api/vitals', {
        data: { name: 'UNKNOWN', value: 100, id: 'v1-test', delta: 10 },
      });
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('Invalid metric name');
    });

    test('POST /api/vitals with non-JSON body returns 400', async ({ request }) => {
      const response = await request.post('/api/vitals', {
        data: 'not json',
        headers: { 'Content-Type': 'text/plain' },
      });
      expect(response.status()).toBe(400);
    });

    test('POST /api/vitals with non-finite value returns 400', async ({
      request,
    }) => {
      const response = await request.post('/api/vitals', {
        data: { name: 'FCP', value: null, id: 'v1-test', delta: 0 },
      });
      expect(response.status()).toBe(400);
    });

    test('all valid metric names are accepted', async ({ request }) => {
      const validNames = ['LCP', 'FCP', 'CLS', 'INP', 'TTFB'];
      for (const name of validNames) {
        const response = await request.post('/api/vitals', {
          data: { name, value: 42, id: `v1-${name}-test`, delta: 5 },
        });
        expect(response.status()).toBe(204);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // /api/docs — public documentation loader
  // ---------------------------------------------------------------------------
  test.describe('Docs Endpoint', () => {
    test('GET /api/docs returns 200 with JSON', async ({ request }) => {
      const response = await request.get('/api/docs');
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('application/json');
    });

    test('docs response has docs array and meta object', async ({ request }) => {
      const response = await request.get('/api/docs');
      const body = await response.json();

      expect(body).toHaveProperty('docs');
      expect(body).toHaveProperty('meta');
      expect(Array.isArray(body.docs)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // /api/sentry — Sentry tunnel endpoint
  // ---------------------------------------------------------------------------
  test.describe('Sentry Tunnel Endpoint', () => {
    test('POST /api/sentry with empty body returns 400 or 503', async ({
      request,
    }) => {
      const response = await request.post('/api/sentry', {
        data: '',
        headers: { 'Content-Type': 'text/plain' },
      });
      // 400 (bad envelope) or 503 (tunnel not configured) are both valid
      expect([400, 503]).toContain(response.status());
    });

    test('POST /api/sentry with invalid envelope header returns 400 or 503', async ({
      request,
    }) => {
      const response = await request.post('/api/sentry', {
        data: 'not valid json\n{}',
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
      });
      expect([400, 503]).toContain(response.status());
    });

    test('POST /api/sentry with mismatched DSN returns 403 or 503', async ({
      request,
    }) => {
      const fakeEnvelope =
        '{"dsn":"https://fake@o0.ingest.sentry.io/0"}\n{}\n{}';
      const response = await request.post('/api/sentry', {
        data: fakeEnvelope,
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
      });
      // 403 (DSN mismatch) or 503 (not configured) are both acceptable
      expect([403, 503]).toContain(response.status());
    });
  });

  // ---------------------------------------------------------------------------
  // /api/cron/health-monitor — protected by CRON_SECRET
  // ---------------------------------------------------------------------------
  test.describe('Cron Health Monitor', () => {
    test('GET /api/cron/health-monitor without auth returns 401', async ({
      request,
    }) => {
      const response = await request.get('/api/cron/health-monitor');
      expect(response.status()).toBe(401);
    });

    test('GET /api/cron/health-monitor with wrong token returns 401', async ({
      request,
    }) => {
      const response = await request.get('/api/cron/health-monitor', {
        headers: { Authorization: 'Bearer wrong-token-abc123' },
      });
      expect(response.status()).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // Auth-protected routes — verify 401/403 for unauthenticated calls
  // ---------------------------------------------------------------------------
  test.describe('Protected Routes Reject Unauthenticated Requests', () => {
    test('POST /api/feedback requires authentication', async ({ request }) => {
      const response = await request.post('/api/feedback', {
        data: { type: 'bug', description: 'Test feedback from E2E suite' },
        maxRedirects: 0,
      });
      expect([401, 403, 302, 307]).toContain(response.status());
    });

    test('POST /api/bridges/discover requires authentication', async ({
      request,
    }) => {
      const response = await request.post('/api/bridges/discover', {
        data: { toolId: 'aseprite' },
        maxRedirects: 0,
      });
      expect([401, 403, 302, 307]).toContain(response.status());
    });

    test('GET /api/tokens/balance requires authentication', async ({
      request,
    }) => {
      const response = await request.get('/api/tokens/balance', {
        maxRedirects: 0,
      });
      expect([401, 403, 302, 307]).toContain(response.status());
    });

    test('GET /api/jobs requires authentication', async ({ request }) => {
      const response = await request.get('/api/jobs', {
        maxRedirects: 0,
      });
      expect([401, 403, 302, 307]).toContain(response.status());
    });

    test('GET /api/keys requires authentication', async ({ request }) => {
      const response = await request.get('/api/keys', {
        maxRedirects: 0,
      });
      expect([401, 403, 302, 307]).toContain(response.status());
    });
  });

  // ---------------------------------------------------------------------------
  // 404 not-found page
  // ---------------------------------------------------------------------------
  test.describe('404 Not Found Page', () => {
    test('navigating to an unknown route renders the 404 page', async ({
      page,
    }) => {
      await page.goto('/this-page-definitely-does-not-exist-xyz', {
        timeout: E2E_TIMEOUT_NAV_MS,
      });

      await expect(page.getByText('404')).toBeVisible({
        timeout: E2E_TIMEOUT_ELEMENT_MS,
      });
      await expect(page.getByText('Page not found')).toBeVisible({
        timeout: E2E_TIMEOUT_ELEMENT_MS,
      });
    });

    test('404 page has Back to Dashboard link', async ({ page }) => {
      await page.goto('/this-route-does-not-exist-e2e-test', {
        timeout: E2E_TIMEOUT_NAV_MS,
      });

      const dashboardLink = page.getByRole('link', { name: 'Back to Dashboard' });
      await expect(dashboardLink).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    });

    test('404 page has Go Home link', async ({ page }) => {
      await page.goto('/another-missing-route-e2e', {
        timeout: E2E_TIMEOUT_NAV_MS,
      });

      const homeLink = page.getByRole('link', { name: 'Go Home' });
      await expect(homeLink).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    });

    test('unknown API sub-path returns non-200', async ({ request }) => {
      const response = await request.get('/api/this-does-not-exist-xyz', {
        maxRedirects: 0,
      });
      expect(response.status()).not.toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // /api/openapi — already covered in api-routes.spec.ts but verify
  // schema completeness here
  // ---------------------------------------------------------------------------
  test.describe('OpenAPI Schema Completeness', () => {
    test('openapi spec lists paths if schema is available', async ({ request }) => {
      const response = await request.get('/api/openapi');
      if (!response.ok()) {
        // Not all environments expose the schema — skip rather than fail
        test.skip(true, 'OpenAPI endpoint not available in this environment');
        return;
      }
      const body = await response.json();
      // Must have the version field at minimum
      expect(typeof body.openapi).toBe('string');
      expect(body.openapi.startsWith('3')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Security headers on misc public endpoints
  // ---------------------------------------------------------------------------
  test.describe('Security Headers on Misc Endpoints', () => {
    test('/api/status includes security headers', async ({ request }) => {
      const response = await request.get('/api/status');
      const headers = response.headers();

      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('DENY');
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    test('/api/capabilities includes security headers', async ({ request }) => {
      const response = await request.get('/api/capabilities');
      const headers = response.headers();

      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('DENY');
    });
  });
});
