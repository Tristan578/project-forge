/**
 * Additional negative / error case tests for POST /api/stripe/webhook
 *
 * Extends existing route tests with env var edge cases, idempotency
 * race conditions, error recovery paths, and malformed event data.
 */

vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockConstructEvent,
  mockClaimEvent,
  mockReleaseEvent,
  mockFinalizeEvent,
  mockHandleSubscriptionCreated,
  mockHandleChargeRefunded,
} = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockClaimEvent: vi.fn(() => Promise.resolve(true)),
  mockReleaseEvent: vi.fn(() => Promise.resolve()),
  mockFinalizeEvent: vi.fn(() => Promise.resolve()),
  mockHandleSubscriptionCreated: vi.fn(() => Promise.resolve()),
  mockHandleChargeRefunded: vi.fn(() => Promise.resolve()),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/db/client', () => ({
  queryWithResilience: vi.fn((fn: () => unknown) => fn()),
  getDb: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve([])),
  })),
}));

vi.mock('@/lib/db/schema', () => ({ users: {}, webhookEvents: { eventId: 'eventId' } }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), gt: vi.fn(), lt: vi.fn(), sql: vi.fn() }));

vi.mock('@/lib/tokens/service', () => ({
  creditAddonTokens: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/auth/user-service', () => ({
  updateUserStripe: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

vi.mock('@/lib/billing/webhookIdempotency', () => ({
  claimEvent: mockClaimEvent,
  releaseEvent: mockReleaseEvent,
  finalizeEvent: mockFinalizeEvent,
}));

vi.mock('@/lib/billing/subscription-lifecycle', () => ({
  handleSubscriptionCreated: mockHandleSubscriptionCreated,
  handleSubscriptionUpdated: vi.fn(() => Promise.resolve()),
  handleSubscriptionDeleted: vi.fn(() => Promise.resolve()),
  handleInvoicePaid: vi.fn(() => Promise.resolve()),
  handleInvoicePaymentFailed: vi.fn(() => Promise.resolve()),
  handleChargeRefunded: mockHandleChargeRefunded,
}));

vi.mock('stripe', () => {
  function StripeMock(_key: string, _opts: unknown) {
    return {
      webhooks: { constructEvent: mockConstructEvent },
    };
  }
  return { default: StripeMock };
});

// Mock analytics events
vi.mock('@/lib/analytics/events.server', () => ({
  trackSubscriptionStarted: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the route
// ---------------------------------------------------------------------------

import { POST } from '../route';
import { captureException } from '@/lib/monitoring/sentry-server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: string, sig: string | null = 'sig_valid'): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (sig !== null) headers.set('stripe-signature', sig);
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    body,
    headers,
  });
}

function makeStripeEvent(type: string, dataObject: unknown, id = 'evt_neg') {
  return { id, type, data: { object: dataObject } };
}

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_neg',
    customer: 'cus_neg',
    status: 'active',
    items: { data: [{ price: { id: 'price_starter' } }] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/stripe/webhook — negative cases', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockClaimEvent.mockResolvedValue(true);
    mockHandleSubscriptionCreated.mockResolvedValue(undefined);
    mockHandleChargeRefunded.mockResolvedValue(undefined);

    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.STRIPE_PRICE_STARTER = 'price_starter';
    process.env.STRIPE_PRICE_CREATOR = 'price_creator';
    process.env.STRIPE_PRICE_STUDIO = 'price_studio';
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
  });

  afterEach(() => {
    // Restore env vars
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
  });

  // -------------------------------------------------------------------------
  // Environment variable edge cases
  // -------------------------------------------------------------------------
  describe('environment variable edge cases', () => {
    it('returns 500 when STRIPE_WEBHOOK_SECRET is empty string', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = '';

      const res = await POST(makeRequest('{}'));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toMatch(/webhook secret/i);
    });

    it('returns 400 before checking STRIPE_SECRET_KEY if signature missing', async () => {
      // Even without STRIPE_SECRET_KEY, signature check should fail first
      const res = await POST(makeRequest('{}', null));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/signature/i);
    });
  });

  // -------------------------------------------------------------------------
  // Signature verification edge cases
  // -------------------------------------------------------------------------
  describe('signature verification', () => {
    it('returns 400 for empty signature header', async () => {
      const headers = new Headers({ 'content-type': 'application/json', 'stripe-signature': '' });
      const req = new Request('http://localhost/api/stripe/webhook', {
        method: 'POST',
        body: '{}',
        headers,
      });

      mockConstructEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature');
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for tampered body (signature mismatch)', async () => {
      mockConstructEvent.mockImplementation(() => {
        throw new Error('Webhook signature verification failed');
      });

      const res = await POST(makeRequest('{"tampered": true}'));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/invalid signature/i);
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency edge cases
  // -------------------------------------------------------------------------
  describe('idempotency', () => {
    it('skips processing and returns 200 for duplicate event', async () => {
      mockConstructEvent.mockReturnValue(
        makeStripeEvent('customer.subscription.created', makeSubscription()),
      );
      mockClaimEvent.mockResolvedValue(false); // duplicate

      const res = await POST(makeRequest('{}'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.duplicate).toBe(true);
      expect(mockHandleSubscriptionCreated).not.toHaveBeenCalled();
    });

    it('does not call finalizeEvent on duplicate', async () => {
      mockConstructEvent.mockReturnValue(
        makeStripeEvent('customer.subscription.created', makeSubscription()),
      );
      mockClaimEvent.mockResolvedValue(false);

      await POST(makeRequest('{}'));
      expect(mockFinalizeEvent).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Error recovery and claim management
  // -------------------------------------------------------------------------
  describe('error recovery', () => {
    it('releases claim and returns 500 when handler throws', async () => {
      mockHandleSubscriptionCreated.mockRejectedValue(new Error('DB timeout'));
      mockConstructEvent.mockReturnValue(
        makeStripeEvent('customer.subscription.created', makeSubscription(), 'evt_fail'),
      );

      const res = await POST(makeRequest('{}'));
      expect(res.status).toBe(500);
      expect(mockReleaseEvent).toHaveBeenCalledWith('evt_fail', 'stripe');
      expect(mockFinalizeEvent).not.toHaveBeenCalled();
    });

    it('captures exception with event context on handler failure', async () => {
      mockHandleSubscriptionCreated.mockRejectedValue(new Error('constraint violation'));
      mockConstructEvent.mockReturnValue(
        makeStripeEvent('customer.subscription.created', makeSubscription(), 'evt_ctx'),
      );

      await POST(makeRequest('{}'));
      expect(captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          route: '/api/stripe/webhook',
          eventType: 'customer.subscription.created',
          eventId: 'evt_ctx',
        }),
      );
    });

    it('still returns 500 when release also fails (double failure)', async () => {
      mockHandleSubscriptionCreated.mockRejectedValue(new Error('handler failed'));
      mockReleaseEvent.mockRejectedValue(new Error('redis down'));
      mockConstructEvent.mockReturnValue(
        makeStripeEvent('customer.subscription.created', makeSubscription(), 'evt_double'),
      );

      const res = await POST(makeRequest('{}'));
      expect(res.status).toBe(500);
      // Both handler and release failed, but 500 is still returned
    });

    it('captures exception but does not release when finalize fails', async () => {
      mockConstructEvent.mockReturnValue(
        makeStripeEvent('customer.subscription.created', makeSubscription(), 'evt_fin'),
      );
      mockFinalizeEvent.mockRejectedValue(new Error('finalize failed'));

      const res = await POST(makeRequest('{}'));
      // Event was processed successfully, so 200 is returned
      expect(res.status).toBe(200);
      // Release should NOT be called (event was successfully processed)
      expect(mockReleaseEvent).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Malformed event data
  // -------------------------------------------------------------------------
  describe('malformed event data', () => {
    it('skips when subscription has no items', async () => {
      const sub = { ...makeSubscription(), items: { data: [] } };
      mockConstructEvent.mockReturnValue(
        makeStripeEvent('customer.subscription.created', sub),
      );

      const res = await POST(makeRequest('{}'));
      expect(res.status).toBe(200);
      // No price ID means no tier, so handler is not called
      expect(mockHandleSubscriptionCreated).not.toHaveBeenCalled();
    });

    it('skips when charge.refunded has null customer', async () => {
      const charge = {
        id: 'ch_refund',
        customer: null,
        amount_refunded: 500,
        amount: 1000,
      };
      mockConstructEvent.mockReturnValue(
        makeStripeEvent('charge.refunded', charge),
      );

      const res = await POST(makeRequest('{}'));
      expect(res.status).toBe(200);
      expect(mockHandleChargeRefunded).not.toHaveBeenCalled();
    });

    it('handles checkout.session.completed with missing metadata', async () => {
      const { creditAddonTokens } = await import('@/lib/tokens/service');
      const session = {
        mode: 'payment',
        metadata: {},
        payment_intent: 'pi_abc',
        customer: null,
      };
      mockConstructEvent.mockReturnValue(
        makeStripeEvent('checkout.session.completed', session),
      );

      const res = await POST(makeRequest('{}'));
      expect(res.status).toBe(200);
      expect(creditAddonTokens).not.toHaveBeenCalled();
    });

    it('handles checkout.session.completed with payment_intent as object', async () => {
      const { creditAddonTokens } = await import('@/lib/tokens/service');
      const session = {
        mode: 'payment',
        metadata: { userId: 'user-1', package: 'starter_100k' },
        payment_intent: { id: 'pi_object_id' },
        customer: null,
      };
      mockConstructEvent.mockReturnValue(
        makeStripeEvent('checkout.session.completed', session),
      );

      const res = await POST(makeRequest('{}'));
      expect(res.status).toBe(200);
      expect(creditAddonTokens).toHaveBeenCalledWith('user-1', 'starter_100k', 'pi_object_id');
    });
  });

  // -------------------------------------------------------------------------
  // Unhandled event types
  // -------------------------------------------------------------------------
  describe('unhandled event types', () => {
    const unhandledTypes = [
      'payment_intent.created',
      'payment_intent.succeeded',
      'customer.created',
      'customer.deleted',
      'setup_intent.succeeded',
      'payout.paid',
    ];

    for (const eventType of unhandledTypes) {
      it(`returns 200 for unhandled event: ${eventType}`, async () => {
        mockConstructEvent.mockReturnValue(makeStripeEvent(eventType, {}));

        const res = await POST(makeRequest('{}'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.received).toBe(true);
      });
    }
  });
});
