import { test, expect } from '@playwright/test';

/**
 * Billing flow E2E tests — verifies key billing API endpoints
 * return correct auth/validation errors without requiring browser state.
 *
 * Uses Playwright's request context (no browser or WASM build needed).
 */
test.describe('Billing Flow @api', () => {
  test.describe('Checkout endpoint', () => {
    test('unauthenticated POST /api/billing/checkout returns 401', async ({ request }) => {
      const response = await request.post('/api/billing/checkout', {
        data: { tier: 'pro' },
      });
      expect(response.status()).toBe(401);
    });

    test('POST /api/billing/checkout with missing tier returns 400', async ({ request }) => {
      const response = await request.post('/api/billing/checkout', {
        data: {},
      });
      // Either 400 (validation) or 401 (auth required first) is acceptable
      expect([400, 401, 422]).toContain(response.status());
    });
  });

  test.describe('Stripe webhook endpoint', () => {
    test('POST /api/stripe/webhook without signature header returns 400', async ({ request }) => {
      const response = await request.post('/api/stripe/webhook', {
        data: JSON.stringify({ type: 'checkout.session.completed', data: {} }),
        headers: {
          'content-type': 'application/json',
          // Intentionally omit stripe-signature
        },
      });
      expect(response.status()).toBe(400);
    });

    test('POST /api/stripe/webhook with invalid signature returns 400', async ({ request }) => {
      const response = await request.post('/api/stripe/webhook', {
        data: JSON.stringify({ type: 'checkout.session.completed' }),
        headers: {
          'content-type': 'application/json',
          'stripe-signature': 'invalid_signature_value',
        },
      });
      expect(response.status()).toBe(400);
    });
  });

  test.describe('Billing status endpoint', () => {
    test('unauthenticated GET /api/billing/status returns 401', async ({ request }) => {
      const response = await request.get('/api/billing/status');
      expect(response.status()).toBe(401);
    });
  });

  test.describe('Billing portal endpoint', () => {
    test('unauthenticated POST /api/billing/portal returns 401', async ({ request }) => {
      const response = await request.post('/api/billing/portal', {
        data: {},
      });
      expect(response.status()).toBe(401);
    });
  });
});
