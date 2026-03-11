/**
 * Unit tests for the Stripe webhook POST handler.
 *
 * Tests cover: missing webhook secret, missing stripe-signature, invalid signature,
 * duplicate event (idempotency), event type dispatch (subscription created/updated/deleted,
 * invoice paid/failed, checkout completed), and error recovery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted() runs before vi.mock factories
// ---------------------------------------------------------------------------

const {
  mockConstructEvent,
  mockClaimEvent,
  mockReleaseEvent,
  mockHandleSubscriptionCreated,
  mockHandleSubscriptionUpdated,
  mockHandleSubscriptionDeleted,
  mockHandleInvoicePaid,
  mockHandleInvoicePaymentFailed,
} = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockClaimEvent: vi.fn(() => true),
  mockReleaseEvent: vi.fn(),
  mockHandleSubscriptionCreated: vi.fn(() => Promise.resolve()),
  mockHandleSubscriptionUpdated: vi.fn(() => Promise.resolve()),
  mockHandleSubscriptionDeleted: vi.fn(() => Promise.resolve()),
  mockHandleInvoicePaid: vi.fn(() => Promise.resolve()),
  mockHandleInvoicePaymentFailed: vi.fn(() => Promise.resolve()),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve([])),
  })),
}));

vi.mock('@/lib/db/schema', () => ({ users: {} }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

vi.mock('@/lib/tokens/service', () => ({
  creditAddonTokens: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/auth/user-service', () => ({
  updateUserStripe: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

vi.mock('@/lib/billing/subscription-lifecycle', () => ({
  claimEvent: mockClaimEvent,
  releaseEvent: mockReleaseEvent,
  handleSubscriptionCreated: mockHandleSubscriptionCreated,
  handleSubscriptionUpdated: mockHandleSubscriptionUpdated,
  handleSubscriptionDeleted: mockHandleSubscriptionDeleted,
  handleInvoicePaid: mockHandleInvoicePaid,
  handleInvoicePaymentFailed: mockHandleInvoicePaymentFailed,
}));

vi.mock('stripe', () => {
  function StripeMock(_key: string, _opts: unknown) {
    return {
      webhooks: { constructEvent: mockConstructEvent },
    };
  }
  return { default: StripeMock };
});

// ---------------------------------------------------------------------------
// Import the route under test (after mocks are registered)
// ---------------------------------------------------------------------------

import { POST } from '../route';

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

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_123',
    customer: 'cus_abc',
    status: 'active',
    items: { data: [{ price: { id: 'price_starter' } }] },
    ...overrides,
  };
}

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv_123',
    customer: 'cus_abc',
    attempt_count: 1,
    next_payment_attempt: null,
    parent: { subscription_details: { subscription: 'sub_123' } },
    ...overrides,
  };
}

function makeStripeEvent(type: string, dataObject: unknown, id = 'evt_001') {
  return { id, type, data: { object: dataObject } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/stripe/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClaimEvent.mockReturnValue(true);
    mockHandleSubscriptionCreated.mockResolvedValue(undefined);
    mockHandleSubscriptionUpdated.mockResolvedValue(undefined);
    mockHandleSubscriptionDeleted.mockResolvedValue(undefined);
    mockHandleInvoicePaid.mockResolvedValue(undefined);
    mockHandleInvoicePaymentFailed.mockResolvedValue(undefined);

    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.STRIPE_PRICE_STARTER = 'price_starter';
    process.env.STRIPE_PRICE_CREATOR = 'price_creator';
    process.env.STRIPE_PRICE_STUDIO = 'price_studio';
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
  });

  // -------------------------------------------------------------------------
  // Guard conditions
  // -------------------------------------------------------------------------

  it('returns 500 when STRIPE_WEBHOOK_SECRET is missing', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const req = makeRequest('{}');
    const res = await POST(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toMatch(/webhook secret/i);
  });

  it('returns 400 when stripe-signature header is missing', async () => {
    const req = makeRequest('{}', null);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/signature/i);
  });

  it('returns 400 when signature verification fails', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('Signature mismatch');
    });

    const req = makeRequest('{}');
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid signature/i);
  });

  // -------------------------------------------------------------------------
  // Idempotency
  // -------------------------------------------------------------------------

  it('returns 200 with duplicate:true for already-processed events', async () => {
    mockConstructEvent.mockReturnValue(makeStripeEvent('customer.subscription.created', makeSubscription()));
    mockClaimEvent.mockReturnValue(false);

    const req = makeRequest('{}');
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duplicate).toBe(true);
    expect(body.received).toBe(true);
  });

  // -------------------------------------------------------------------------
  // customer.subscription.created
  // -------------------------------------------------------------------------

  it('calls handleSubscriptionCreated for customer.subscription.created', async () => {
    const sub = makeSubscription({ customer: 'cus_new' });
    mockConstructEvent.mockReturnValue(makeStripeEvent('customer.subscription.created', sub));

    const res = await POST(makeRequest('{}'));
    expect(res.status).toBe(200);
    expect(mockHandleSubscriptionCreated).toHaveBeenCalledWith('cus_new', 'sub_123', 'hobbyist');
  });

  it('skips handleSubscriptionCreated when customer is null', async () => {
    const sub = makeSubscription({ customer: null });
    mockConstructEvent.mockReturnValue(makeStripeEvent('customer.subscription.created', sub));

    await POST(makeRequest('{}'));
    expect(mockHandleSubscriptionCreated).not.toHaveBeenCalled();
  });

  it('skips handleSubscriptionCreated when priceId maps to no tier', async () => {
    const sub = makeSubscription({ items: { data: [{ price: { id: 'price_unknown' } }] } });
    mockConstructEvent.mockReturnValue(makeStripeEvent('customer.subscription.created', sub));

    await POST(makeRequest('{}'));
    expect(mockHandleSubscriptionCreated).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // customer.subscription.updated
  // -------------------------------------------------------------------------

  it('calls handleSubscriptionUpdated for customer.subscription.updated', async () => {
    const sub = makeSubscription({
      customer: 'cus_upd',
      status: 'past_due',
      items: { data: [{ price: { id: 'price_creator' } }] },
    });
    mockConstructEvent.mockReturnValue(makeStripeEvent('customer.subscription.updated', sub));

    await POST(makeRequest('{}'));

    expect(mockHandleSubscriptionUpdated).toHaveBeenCalledWith('cus_upd', 'sub_123', 'creator', 'past_due');
  });

  // -------------------------------------------------------------------------
  // customer.subscription.deleted
  // -------------------------------------------------------------------------

  it('calls handleSubscriptionDeleted for customer.subscription.deleted', async () => {
    const sub = makeSubscription({ customer: 'cus_del' });
    mockConstructEvent.mockReturnValue(makeStripeEvent('customer.subscription.deleted', sub));

    await POST(makeRequest('{}'));

    expect(mockHandleSubscriptionDeleted).toHaveBeenCalledWith('cus_del', 'sub_123');
  });

  it('skips handleSubscriptionDeleted when customer is null', async () => {
    const sub = makeSubscription({ customer: null });
    mockConstructEvent.mockReturnValue(makeStripeEvent('customer.subscription.deleted', sub));

    await POST(makeRequest('{}'));
    expect(mockHandleSubscriptionDeleted).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // invoice.paid
  // -------------------------------------------------------------------------

  it('calls handleInvoicePaid for invoice.paid', async () => {
    const invoice = makeInvoice({ customer: 'cus_paid' });
    mockConstructEvent.mockReturnValue(makeStripeEvent('invoice.paid', invoice));

    await POST(makeRequest('{}'));

    expect(mockHandleInvoicePaid).toHaveBeenCalledWith('cus_paid', 'inv_123', 'sub_123');
  });

  it('skips handleInvoicePaid when customer is null', async () => {
    const invoice = makeInvoice({ customer: null });
    mockConstructEvent.mockReturnValue(makeStripeEvent('invoice.paid', invoice));

    await POST(makeRequest('{}'));
    expect(mockHandleInvoicePaid).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // invoice.payment_failed
  // -------------------------------------------------------------------------

  it('calls handleInvoicePaymentFailed with attempt count and next attempt date', async () => {
    const invoice = makeInvoice({
      customer: 'cus_fail',
      attempt_count: 2,
      next_payment_attempt: 1700000000,
    });
    mockConstructEvent.mockReturnValue(makeStripeEvent('invoice.payment_failed', invoice));

    await POST(makeRequest('{}'));

    expect(mockHandleInvoicePaymentFailed).toHaveBeenCalledWith(
      'cus_fail',
      'inv_123',
      2,
      expect.any(Date),
    );
  });

  it('passes null nextAttempt when next_payment_attempt is null', async () => {
    const invoice = makeInvoice({
      customer: 'cus_fail2',
      attempt_count: 1,
      next_payment_attempt: null,
    });
    mockConstructEvent.mockReturnValue(makeStripeEvent('invoice.payment_failed', invoice));

    await POST(makeRequest('{}'));

    expect(mockHandleInvoicePaymentFailed).toHaveBeenCalledWith('cus_fail2', 'inv_123', 1, null);
  });

  // -------------------------------------------------------------------------
  // checkout.session.completed
  // -------------------------------------------------------------------------

  it('calls creditAddonTokens for checkout.session.completed in payment mode', async () => {
    const { creditAddonTokens } = await import('@/lib/tokens/service');
    const session = {
      mode: 'payment',
      metadata: { userId: 'user-1', package: 'starter_100k' },
      payment_intent: 'pi_abc',
      customer: null,
    };
    mockConstructEvent.mockReturnValue(makeStripeEvent('checkout.session.completed', session));

    await POST(makeRequest('{}'));

    expect(creditAddonTokens).toHaveBeenCalledWith('user-1', 'starter_100k', 'pi_abc');
  });

  it('skips creditAddonTokens when checkout mode is not payment', async () => {
    const { creditAddonTokens } = await import('@/lib/tokens/service');
    const session = {
      mode: 'subscription',
      metadata: { userId: 'user-1', package: 'starter_100k' },
      payment_intent: 'pi_abc',
      customer: null,
    };
    mockConstructEvent.mockReturnValue(makeStripeEvent('checkout.session.completed', session));

    await POST(makeRequest('{}'));

    expect(creditAddonTokens).not.toHaveBeenCalled();
  });

  it('skips creditAddonTokens when userId is missing from metadata', async () => {
    const { creditAddonTokens } = await import('@/lib/tokens/service');
    const session = {
      mode: 'payment',
      metadata: { package: 'starter_100k' },
      payment_intent: 'pi_abc',
      customer: null,
    };
    mockConstructEvent.mockReturnValue(makeStripeEvent('checkout.session.completed', session));

    await POST(makeRequest('{}'));

    expect(creditAddonTokens).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Error recovery
  // -------------------------------------------------------------------------

  it('releases event claim and still returns 200 on handler error', async () => {
    const { captureException } = await import('@/lib/monitoring/sentry-server');
    mockHandleSubscriptionCreated.mockRejectedValueOnce(new Error('DB write failed'));

    const sub = makeSubscription({ customer: 'cus_err' });
    mockConstructEvent.mockReturnValue(makeStripeEvent('customer.subscription.created', sub, 'evt_err'));

    const res = await POST(makeRequest('{}'));

    expect(res.status).toBe(200);
    expect(mockReleaseEvent).toHaveBeenCalledWith('evt_err');
    expect(captureException).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Unknown event type (no-op)
  // -------------------------------------------------------------------------

  it('returns 200 for unhandled event types without calling any handler', async () => {
    mockConstructEvent.mockReturnValue(makeStripeEvent('payment_intent.created', {}));

    const res = await POST(makeRequest('{}'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.received).toBe(true);
    expect(mockHandleSubscriptionCreated).not.toHaveBeenCalled();
    expect(mockHandleInvoicePaid).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // resolveCustomerId — customer object vs string
  // -------------------------------------------------------------------------

  it('resolves customer ID from expanded customer object (not just string ID)', async () => {
    const sub = makeSubscription({
      customer: { id: 'cus_object', deleted: false },
    });
    mockConstructEvent.mockReturnValue(makeStripeEvent('customer.subscription.created', sub));

    await POST(makeRequest('{}'));

    expect(mockHandleSubscriptionCreated).toHaveBeenCalledWith('cus_object', 'sub_123', 'hobbyist');
  });
});
