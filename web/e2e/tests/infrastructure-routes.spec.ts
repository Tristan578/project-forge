import { test, expect } from '@playwright/test';

/**
 * PF-14: Infrastructure routes E2E tests — covers remaining gaps
 * not addressed by api-routes.spec.ts, misc-routes.spec.ts, or
 * billing-flow.spec.ts.
 *
 * Focuses on:
 *   - /api/jobs           POST validation, auth
 *   - /api/jobs/[id]      PATCH auth, ownership
 *   - Security header consistency across all infrastructure endpoints
 *   - Response time budgets for health-critical routes
 *
 * Uses Playwright's request context (no browser or WASM build needed).
 */

test.describe('Infrastructure Routes @api', () => {
  // ---------------------------------------------------------------------------
  // /api/jobs — POST (create job record)
  // ---------------------------------------------------------------------------
  test.describe('Jobs Create Endpoint', () => {
    test('POST /api/jobs requires authentication', async ({ request }) => {
      const response = await request.post('/api/jobs', {
        data: {
          providerJobId: 'test-123',
          provider: 'test',
          type: 'sprite',
          prompt: 'test prompt',
        },
        maxRedirects: 0,
      });
      expect([401, 403, 302, 307]).toContain(response.status());
    });
  });

  // ---------------------------------------------------------------------------
  // /api/jobs/[id] — PATCH (update job status)
  // ---------------------------------------------------------------------------
  test.describe('Jobs Update Endpoint', () => {
    test('PATCH /api/jobs/fake-id requires authentication', async ({ request }) => {
      const response = await request.patch('/api/jobs/fake-job-id', {
        data: { status: 'completed' },
        maxRedirects: 0,
      });
      expect([401, 403, 302, 307]).toContain(response.status());
    });
  });

  // ---------------------------------------------------------------------------
  // Security headers — consistency across all infrastructure endpoints
  // ---------------------------------------------------------------------------
  test.describe('Security Headers Consistency', () => {
    const publicEndpoints = [
      '/api/health',
      '/api/status',
      '/api/capabilities',
      '/api/docs',
    ];

    for (const endpoint of publicEndpoints) {
      test(`${endpoint} has x-content-type-options: nosniff`, async ({ request }) => {
        const response = await request.get(endpoint);
        expect(response.headers()['x-content-type-options']).toBe('nosniff');
      });

      test(`${endpoint} has x-frame-options: DENY`, async ({ request }) => {
        const response = await request.get(endpoint);
        expect(response.headers()['x-frame-options']).toBe('DENY');
      });

      test(`${endpoint} has referrer-policy header`, async ({ request }) => {
        const response = await request.get(endpoint);
        expect(response.headers()['referrer-policy']).toBeTruthy();
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Response time budgets — health-critical routes must respond quickly
  // ---------------------------------------------------------------------------
  test.describe('Response Time Budgets', () => {
    test('/api/health responds within 5 seconds', async ({ request }) => {
      const start = Date.now();
      const response = await request.get('/api/health');
      const elapsed = Date.now() - start;

      expect(response.status()).toBe(200);
      expect(elapsed).toBeLessThan(5_000);
    });

    test('/api/status responds within 5 seconds', async ({ request }) => {
      const start = Date.now();
      const response = await request.get('/api/status');
      const elapsed = Date.now() - start;

      expect(response.status()).toBe(200);
      expect(elapsed).toBeLessThan(5_000);
    });

    test('/api/capabilities responds within 3 seconds', async ({ request }) => {
      const start = Date.now();
      const response = await request.get('/api/capabilities');
      const elapsed = Date.now() - start;

      expect(response.status()).toBe(200);
      expect(elapsed).toBeLessThan(3_000);
    });
  });

  // ---------------------------------------------------------------------------
  // Content-Type validation — JSON endpoints return proper content types
  // ---------------------------------------------------------------------------
  test.describe('Content-Type Validation', () => {
    test('all JSON infrastructure endpoints return application/json', async ({ request }) => {
      const endpoints = ['/api/health', '/api/status', '/api/capabilities', '/api/docs'];

      for (const endpoint of endpoints) {
        const response = await request.get(endpoint);
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toContain('application/json');
      }
    });

    test('/api/vitals returns 204 with no body on valid POST', async ({ request }) => {
      const response = await request.post('/api/vitals', {
        data: { name: 'LCP', value: 1234, id: 'v1-infra-test', delta: 100 },
      });
      expect(response.status()).toBe(204);
    });
  });

  // ---------------------------------------------------------------------------
  // Method validation — endpoints reject wrong HTTP methods
  // ---------------------------------------------------------------------------
  test.describe('Method Validation', () => {
    test('GET /api/vitals returns 405 or 404', async ({ request }) => {
      const response = await request.get('/api/vitals');
      // Vitals is POST-only — GET should be rejected
      expect([404, 405]).toContain(response.status());
    });

    test('DELETE /api/health is not allowed', async ({ request }) => {
      const response = await request.delete('/api/health');
      // Health is GET-only
      expect([404, 405]).toContain(response.status());
    });

    test('PUT /api/status is not allowed', async ({ request }) => {
      const response = await request.put('/api/status', { data: {} });
      expect([404, 405]).toContain(response.status());
    });
  });

  // ---------------------------------------------------------------------------
  // Cron endpoint — deeper validation
  // ---------------------------------------------------------------------------
  test.describe('Cron Health Monitor', () => {
    test('POST /api/cron/health-monitor is rejected (GET only)', async ({ request }) => {
      const response = await request.post('/api/cron/health-monitor', {
        data: {},
      });
      // Either method not allowed or auth rejection
      expect([401, 404, 405]).toContain(response.status());
    });

    test('GET /api/cron/health-monitor with empty auth header returns 401', async ({ request }) => {
      const response = await request.get('/api/cron/health-monitor', {
        headers: { Authorization: '' },
      });
      expect(response.status()).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // CORS — infrastructure endpoints should not include permissive CORS
  // ---------------------------------------------------------------------------
  test.describe('CORS Safety', () => {
    test('/api/health does not include Access-Control-Allow-Origin: *', async ({ request }) => {
      const response = await request.get('/api/health');
      const acao = response.headers()['access-control-allow-origin'];
      // Either no CORS header or not wildcard
      expect(acao).not.toBe('*');
    });

    test('/api/status does not include Access-Control-Allow-Origin: *', async ({ request }) => {
      const response = await request.get('/api/status');
      const acao = response.headers()['access-control-allow-origin'];
      expect(acao).not.toBe('*');
    });
  });
});
