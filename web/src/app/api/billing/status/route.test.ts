vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { makeUser } from '@/test/utils/apiTestUtils';

vi.mock('@/lib/api/middleware');
vi.mock('@/lib/logging/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

// Mock Stripe — capture constructor args to verify apiVersion
const { mockSubscriptionRetrieve, capturedStripeOpts } = vi.hoisted(() => ({
  mockSubscriptionRetrieve: vi.fn(),
  capturedStripeOpts: { value: null as { apiVersion: string } | null },
}));

vi.mock('stripe', () => {
  return {
    default: class MockStripe {
      subscriptions = { retrieve: mockSubscriptionRetrieve };
      constructor(_key: string, opts: { apiVersion: string }) {
        capturedStripeOpts.value = opts;
      }
    },
  };
});

function makeReq() {
  return new NextRequest('http://localhost:3000/api/billing/status', { method: 'GET' });
}

function mockMiddlewareSuccess(overrides?: Partial<ReturnType<typeof makeUser>>) {
  const user = makeUser(overrides);
  vi.mocked(withApiMiddleware).mockResolvedValue({
    error: undefined,
    userId: user.id,
    authContext: { clerkId: 'clerk123', user } as never,
    body: undefined,
  });
  return user;
}

describe('GET /api/billing/status', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  });

  it('returns 401 if unauthenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: mockResponse as never,
      userId: null,
      authContext: null,
      body: undefined,
    });

    const { GET } = await import('./route');
    const res = await GET(makeReq());

    expect(res.status).toBe(401);
  });

  it('returns current tier and billing status for authenticated user', async () => {
    const cycleStart = new Date('2026-03-01T12:00:00Z');
    mockMiddlewareSuccess({
      tier: 'pro',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      billingCycleStart: cycleStart,
    });

    mockSubscriptionRetrieve.mockResolvedValue({ status: 'active' });

    const { GET } = await import('./route');
    const res = await GET(makeReq());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.tier).toBe('pro');
    expect(data.stripeCustomerId).toBe('cus_123');
    expect(data.stripeSubscriptionId).toBe('sub_123');
    expect(data.billingCycleStart).toBe(cycleStart.toISOString());

    // Check refill date is 30 days after cycle start
    const expectedRefill = new Date(cycleStart);
    expectedRefill.setDate(expectedRefill.getDate() + 30);
    expect(data.nextRefillDate).toBe(expectedRefill.toISOString());
  });

  it('returns nulls when no subscription exists', async () => {
    mockMiddlewareSuccess({
      tier: 'starter',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      billingCycleStart: null,
    });

    const { GET } = await import('./route');
    const res = await GET(makeReq());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.tier).toBe('starter');
    expect(data.stripeCustomerId).toBeNull();
    expect(data.stripeSubscriptionId).toBeNull();
    expect(data.billingCycleStart).toBeNull();
    expect(data.nextRefillDate).toBeNull();
  });

  it('initialises Stripe with the v22 API version', async () => {
    mockMiddlewareSuccess({
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
    });
    mockSubscriptionRetrieve.mockResolvedValue({ status: 'active' });

    const { GET } = await import('./route');
    await GET(makeReq());

    expect(capturedStripeOpts.value?.apiVersion).toBe('2026-03-25.dahlia');
  });

  it('returns subscriptionStatus from Stripe', async () => {
    mockMiddlewareSuccess({
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
    });
    mockSubscriptionRetrieve.mockResolvedValue({ status: 'active' });

    const { GET } = await import('./route');
    const res = await GET(makeReq());
    const data = await res.json();

    expect(data.subscriptionStatus).toBe('active');
  });

  it('gracefully degrades when Stripe subscription lookup fails', async () => {
    mockMiddlewareSuccess({
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
    });
    mockSubscriptionRetrieve.mockRejectedValue(new Error('Stripe unavailable'));

    const { GET } = await import('./route');
    const res = await GET(makeReq());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.subscriptionStatus).toBeNull();
  });
});
