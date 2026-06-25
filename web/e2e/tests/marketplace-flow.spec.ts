import { test, expect } from '@playwright/test';

/**
 * #8603: Marketplace purchase / download flow coverage.
 *
 * There is NO /marketplace page route — only /api/marketplace/* endpoints and
 * the /community gallery page. So the "listing / purchase / download flow" is
 * exercised at the API layer, via Playwright's request context (no browser or
 * WASM build needed). A `page.goto('/marketplace')` would hit the 404 page and
 * give hollow coverage.
 *
 * In the CI env (`next start`, SKIP_ENV_VALIDATION=true, no DATABASE_URL /
 * Clerk):
 *   - the public listing (GET /api/marketplace/assets) returns 200 JSON when
 *     the DB is reachable, OR 500 when it is not — both are accepted;
 *   - the auth-gated download / purchase / seller routes reject the
 *     unauthenticated request (401/403/302/307), never serving real data.
 */

const FAKE_ASSET_ID = 'asset_e2e_nonexistent_8603';

test.describe('Marketplace API @api', () => {
  // -------------------------------------------------------------------------
  // Public listing — GET /api/marketplace/assets
  // -------------------------------------------------------------------------
  test.describe('Public asset listing', () => {
    test('returns {assets,hasMore} JSON (200) or 500 when DB unavailable', async ({ request }) => {
      const response = await request.get('/api/marketplace/assets', { maxRedirects: 0 });
      // Public route: 200 with the listing shape when the DB is reachable,
      // 500 when it is not. Never an auth redirect.
      expect([200, 500]).toContain(response.status());

      const contentType = response.headers()['content-type'] ?? '';
      expect(contentType).toContain('application/json');

      const body = await response.json();
      if (response.status() === 200) {
        expect(Array.isArray(body.assets)).toBe(true);
        expect(typeof body.hasMore).toBe('boolean');
      } else {
        expect(typeof body.error).toBe('string');
      }
    });

    test('sets a public Cache-Control header on success', async ({ request }) => {
      const response = await request.get('/api/marketplace/assets', { maxRedirects: 0 });
      if (response.status() === 200) {
        const cacheControl = response.headers()['cache-control'] ?? '';
        expect(cacheControl).toContain('public');
      }
    });

    test('accepts query params (category, sort, page) without erroring out', async ({ request }) => {
      const response = await request.get(
        '/api/marketplace/assets?category=sprite&sort=newest&page=1',
        { maxRedirects: 0 }
      );
      // Same tolerant contract — the listing is public, so no auth redirect.
      expect([200, 500]).toContain(response.status());
    });
  });

  // -------------------------------------------------------------------------
  // Download — GET /api/marketplace/assets/[id]/download (auth required)
  // -------------------------------------------------------------------------
  test.describe('Download endpoint requires auth', () => {
    test('GET download rejects unauthenticated requests', async ({ request }) => {
      const response = await request.get(
        `/api/marketplace/assets/${FAKE_ASSET_ID}/download`,
        { maxRedirects: 0 }
      );
      // withApiMiddleware({ requireAuth: true }) rejects: 401/403, or a redirect
      // to sign-in (302/307). Never 200 with a signed download URL.
      expect([401, 403, 302, 307]).toContain(response.status());
    });

    test('download endpoint is wired (not 404)', async ({ request }) => {
      const response = await request.get(
        `/api/marketplace/assets/${FAKE_ASSET_ID}/download`,
        { maxRedirects: 0 }
      );
      expect(response.status()).not.toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // Purchase — POST /api/marketplace/assets/[id]/purchase (auth required)
  // -------------------------------------------------------------------------
  test.describe('Purchase endpoint requires auth', () => {
    test('POST purchase rejects unauthenticated requests', async ({ request }) => {
      const response = await request.post(
        `/api/marketplace/assets/${FAKE_ASSET_ID}/purchase`,
        { data: {}, maxRedirects: 0 }
      );
      expect([401, 403, 302, 307]).toContain(response.status());
    });

    test('purchase endpoint is wired (not 404)', async ({ request }) => {
      const response = await request.post(
        `/api/marketplace/assets/${FAKE_ASSET_ID}/purchase`,
        { data: {}, maxRedirects: 0 }
      );
      expect(response.status()).not.toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // Seller profile — GET /api/marketplace/seller (auth required)
  // -------------------------------------------------------------------------
  test.describe('Seller endpoint requires auth', () => {
    test('GET seller profile rejects unauthenticated requests', async ({ request }) => {
      const response = await request.get('/api/marketplace/seller', { maxRedirects: 0 });
      expect([401, 403, 302, 307]).toContain(response.status());
    });
  });
});
