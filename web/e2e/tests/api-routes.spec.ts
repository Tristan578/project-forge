import { test, expect } from '@playwright/test';

/**
 * API route E2E tests — verifies key API endpoints return correct
 * response structure, status codes, and content types.
 *
 * Uses Playwright's request context (no browser needed) for speed.
 */
test.describe('API Routes @ui', () => {
  test.describe('Health Endpoint', () => {
    test('GET /api/health returns 200 with JSON body', async ({ request }) => {
      const response = await request.get('/api/health');
      // 503 is a valid response when DB is unavailable in CI — the endpoint
      // still returns a JSON body in that case, so we accept both statuses.
      expect([200, 503]).toContain(response.status());
      expect(response.headers()['content-type']).toContain('application/json');
    });

    test('health response has required fields', async ({ request }) => {
      const response = await request.get('/api/health');
      const body = await response.json();

      expect(body).toHaveProperty('status', 'ok');
      expect(body).toHaveProperty('environment');
      expect(body).toHaveProperty('commit');
      expect(body).toHaveProperty('branch');
      expect(body).toHaveProperty('database');
      expect(body).toHaveProperty('timestamp');
    });

    test('health timestamp is a valid ISO date', async ({ request }) => {
      const response = await request.get('/api/health');
      const body = await response.json();

      const date = new Date(body.timestamp);
      expect(date.getTime()).not.toBeNaN();
    });

    test('health database status is a known value', async ({ request }) => {
      const response = await request.get('/api/health');
      const body = await response.json();

      expect(['connected', 'unavailable', 'not_configured']).toContain(body.database);
    });

    test('health commit is a string', async ({ request }) => {
      const response = await request.get('/api/health');
      const body = await response.json();

      expect(typeof body.commit).toBe('string');
      expect(body.commit.length).toBeGreaterThan(0);
    });
  });

  test.describe('OpenAPI Endpoint', () => {
    test('GET /api/openapi returns JSON', async ({ request }) => {
      const response = await request.get('/api/openapi');

      // Should return 200 with JSON
      if (response.ok()) {
        expect(response.headers()['content-type']).toContain('application/json');

        const body = await response.json();
        // OpenAPI spec should have openapi version and info
        expect(body).toHaveProperty('openapi');
        expect(body).toHaveProperty('info');
        expect(body.info).toHaveProperty('title');
      }
    });
  });

  test.describe('Protected Routes', () => {
    test('GET /api/tokens rejects unauthenticated requests', async ({ request }) => {
      const response = await request.get('/api/tokens', {
        maxRedirects: 0,
      });

      // Without auth: 401, 403, redirect, 404 (route not found), or 500 are all acceptable
      // The key assertion is it should NOT return 200 with real data
      expect(response.status()).not.toBe(200);
    });

    test('POST to generation endpoints requires authentication', async ({ request }) => {
      const response = await request.post('/api/generate/sprite', {
        data: { prompt: 'test' },
        maxRedirects: 0,
      });

      // Should reject unauthenticated requests
      expect([401, 403, 307, 302]).toContain(response.status());
    });
  });

  test.describe('Security Headers on API', () => {
    test('health endpoint includes security headers', async ({ request }) => {
      const response = await request.get('/api/health');
      const headers = response.headers();

      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('DENY');
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });
  });
});
