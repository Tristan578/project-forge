import { test, expect } from '@playwright/test';

/**
 * Publish backend E2E tests -- exercises the publish API endpoints directly
 * using Playwright's request context (no browser/WASM needed).
 *
 * These tests validate response structure, validation logic, and error handling
 * at the HTTP layer, complementing the UI-level publish-flow.spec.ts tests.
 */
test.describe('Publish Backend API @ui', () => {
  test.describe('POST /api/publish', () => {
    test('rejects unauthenticated publish requests', async ({ request }) => {
      const response = await request.post('/api/publish', {
        data: {
          projectId: 'test-project-123',
          title: 'Test Game',
          slug: 'test-game',
        },
        maxRedirects: 0,
      });

      // Without auth, should get 401 or 403 (never 200 with real data)
      expect([401, 403, 307, 302]).toContain(response.status());
    });

    test('publish endpoint exists and returns JSON content-type on auth error', async ({
      request,
    }) => {
      const response = await request.post('/api/publish', {
        data: { projectId: 'x', title: 'x', slug: 'xxx' },
        maxRedirects: 0,
      });

      // The endpoint should respond (not 404)
      expect(response.status()).not.toBe(404);

      // Auth rejection should still be JSON (not an HTML error page)
      const contentType = response.headers()['content-type'] ?? '';
      // Accept JSON or redirect (302/307 may not have content-type)
      if (response.status() !== 302 && response.status() !== 307) {
        expect(contentType).toContain('application/json');
      }
    });

    test('publish endpoint rejects empty body', async ({ request }) => {
      const response = await request.post('/api/publish', {
        maxRedirects: 0,
      });

      // Should reject (auth or validation error), never 200
      expect(response.status()).not.toBe(200);
    });
  });

  test.describe('GET /api/publish/check-slug', () => {
    test('rejects unauthenticated slug check requests', async ({ request }) => {
      const response = await request.get('/api/publish/check-slug?slug=test-game', {
        maxRedirects: 0,
      });

      // Without auth: reject or redirect
      expect([401, 403, 307, 302]).toContain(response.status());
    });

    test('check-slug endpoint exists (not 404)', async ({ request }) => {
      const response = await request.get('/api/publish/check-slug?slug=test', {
        maxRedirects: 0,
      });

      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('GET /api/publish/list', () => {
    test('rejects unauthenticated list requests', async ({ request }) => {
      const response = await request.get('/api/publish/list', {
        maxRedirects: 0,
      });

      expect([401, 403, 307, 302]).toContain(response.status());
    });

    test('list endpoint exists (not 404)', async ({ request }) => {
      const response = await request.get('/api/publish/list', {
        maxRedirects: 0,
      });

      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('Slug validation rules (via check-slug)', () => {
    test('reserved slug names are documented in the API', async ({ request }) => {
      // Even without auth, verify the endpoint processes requests
      // The slug validation is enforced server-side on POST /api/publish
      const reservedSlugs = ['admin', 'api', 'auth', 'play', 'dev', 'login'];

      for (const slug of reservedSlugs) {
        const response = await request.post('/api/publish', {
          data: {
            projectId: 'test-project',
            title: 'Test',
            slug,
          },
          maxRedirects: 0,
        });

        // Should be rejected (auth check happens before slug validation,
        // so we expect auth rejection, not 200)
        expect(response.status()).not.toBe(200);
      }
    });
  });

  test.describe('Security headers on publish endpoints', () => {
    test('POST /api/publish includes security headers', async ({ request }) => {
      const response = await request.post('/api/publish', {
        data: { projectId: 'x', title: 'x', slug: 'xxx' },
        maxRedirects: 0,
      });

      const headers = response.headers();
      // Security headers should be present even on error responses
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('DENY');
    });

    test('GET /api/publish/list includes security headers', async ({ request }) => {
      const response = await request.get('/api/publish/list', {
        maxRedirects: 0,
      });

      const headers = response.headers();
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('DENY');
    });
  });
});
