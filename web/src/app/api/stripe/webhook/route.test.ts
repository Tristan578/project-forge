import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { captureException } from '@/lib/monitoring/sentry-server';
import * as lifecycle from '@/lib/billing/subscription-lifecycle';
import * as idempotency from '@/lib/billing/webhookIdempotency';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/monitoring/sentry-server');
vi.mock('@/lib/billing/subscription-lifecycle');
vi.mock('@/lib/billing/webhookIdempotency');
vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn().mockReturnValue({}),
}));
vi.mock('@/lib/tokens/service');
vi.mock('@/lib/auth/user-service');

const { mockConstructEvent } = vi.hoisted(() => {
  return { mockConstructEvent: vi.fn() };
});

vi.mock('stripe', () => {
  return {
    default: class MockStripe {
      webhooks = {
        constructEvent: mockConstructEvent,
      };
    },
  };
});

describe('POST /api/stripe/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_mock');
    vi.stubEnv('STRIPE_PRICE_STARTER', 'price_starter_mock');
    vi.stubEnv('STRIPE_PRICE_CREATOR', 'price_creator_mock');
    vi.stubEnv('STRIPE_PRICE_STUDIO', 'price_studio_mock');

    vi.mocked(idempotency.claimEvent).mockResolvedValue(true);
    vi.mocked(idempotency.releaseEvent).mockResolvedValue(undefined);
    vi.mocked(idempotency.finalizeEvent).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 500 if WEBHOOK_SECRET is missing', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    const req = new Request('http://localhost/api/stripe/webhook', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it('returns 400 if signature is missing', async () => {
    const req = new Request('http://localhost/api/stripe/webhook', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 if signature is invalid', async () => {
    mockConstructEvent.mockImplementation(() => { throw new Error('Invalid sig'); });
    const req = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'invalid_sig' }
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('skips duplicate events (idempotency)', async () => {
    mockConstructEvent.mockReturnValue({ id: 'evt_123', type: 'customer.subscription.created' });
    vi.mocked(idempotency.claimEvent).mockResolvedValue(false);

    const req = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'valid_sig' }
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.duplicate).toBe(true);
    expect(lifecycle.handleSubscriptionCreated).not.toHaveBeenCalled();
  });

  it('processes customer.subscription.created', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_create',
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          items: { data: [{ price: { id: 'price_creator_mock' } }] },
        },
      },
    });

    const req = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'valid_sig' },
      body: 'body',
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(lifecycle.handleSubscriptionCreated).toHaveBeenCalledWith('cus_123', 'sub_123', 'creator');
    expect(idempotency.claimEvent).toHaveBeenCalledWith('evt_create', 'stripe');
  });

  it('processes customer.subscription.updated', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_update',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'active',
          items: { data: [{ price: { id: 'price_studio_mock' } }] },
        },
      },
    });

    const req = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'valid_sig' },
      body: 'body',
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(lifecycle.handleSubscriptionUpdated).toHaveBeenCalledWith('cus_123', 'sub_123', 'pro', 'active');
  });

  it('releases claim and logs errors on processing failure', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_err',
      type: 'customer.subscription.created',
      data: {
        object: { customer: 'cus_err', items: { data: [{ price: { id: 'price_creator_mock' } }] } },
      },
    });

    vi.mocked(lifecycle.handleSubscriptionCreated).mockRejectedValue(new Error('DB Error'));

    const req = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'valid_sig' },
      body: 'body',
    });
    const res = await POST(req);

    expect(res.status).toBe(200); // Stripe needs 2xx
    expect(captureException).toHaveBeenCalled();
    // The claim should be released so Stripe can retry
    expect(idempotency.releaseEvent).toHaveBeenCalledWith('evt_err');
  });
});
