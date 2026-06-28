vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { makeUser } from '@/test/utils/apiTestUtils';

vi.mock('@/lib/api/middleware');
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

// Mock Stripe — capture constructor args to verify apiVersion
const { mockPortalCreate, capturedStripeOpts } = vi.hoisted(() => ({
  mockPortalCreate: vi.fn(),
  capturedStripeOpts: { value: null as { apiVersion: string } | null },
}));

vi.mock('stripe', () => {
  return {
    default: class MockStripe {
      billingPortal = {
        sessions: {
          create: mockPortalCreate,
        },
      };
      constructor(_key: string, opts: { apiVersion: string }) {
        capturedStripeOpts.value = opts;
      }
    },
  };
});

function makeReq(url = 'http://localhost:3000/api/billing/portal') {
  return new NextRequest(url, { method: 'POST' });
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

describe('POST /api/billing/portal', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  });

  it('returns 401 if unauthenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: mockResponse as never,
      userId: null,
      authContext: null,
      body: undefined,
    });

    const { POST } = await import('./route');
    const res = await POST(makeReq());

    expect(res.status).toBe(401);
  });

  it('returns 429 if rate limited', async () => {
    const rlResponse = new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 });
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: rlResponse as never,
      userId: null,
      authContext: null,
      body: undefined,
    });

    const { POST } = await import('./route');
    const res = await POST(makeReq());

    expect(res.status).toBe(429);
  });

  it('returns 400 if user has no Stripe customer ID', async () => {
    mockMiddlewareSuccess({ stripeCustomerId: null });

    const { POST } = await import('./route');
    const res = await POST(makeReq());
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('No Stripe customer found');
  });

  it('returns billing portal URL for valid customer', async () => {
    mockMiddlewareSuccess({ stripeCustomerId: 'cus_123' });
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/mock' });

    const { POST } = await import('./route');
    const res = await POST(makeReq());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.url).toBe('https://billing.stripe.com/p/session/mock');
    expect(mockPortalCreate).toHaveBeenCalledWith({
      customer: 'cus_123',
      return_url: 'http://localhost:3000/dashboard',
    });
  });

  it('initialises Stripe with the v22 API version', async () => {
    mockMiddlewareSuccess({ stripeCustomerId: 'cus_123' });
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/mock' });

    const { POST } = await import('./route');
    await POST(makeReq());

    expect(capturedStripeOpts.value?.apiVersion).toBe('2026-06-24.dahlia');
  });

  it('pins the portal configuration id from STRIPE_PORTAL_CONFIGURATION_ID', async () => {
    process.env.STRIPE_PORTAL_CONFIGURATION_ID = 'bpc_test_123';
    mockMiddlewareSuccess({ stripeCustomerId: 'cus_123' });
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/mock' });

    const { POST } = await import('./route');
    await POST(makeReq());

    expect(mockPortalCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_123', configuration: 'bpc_test_123' })
    );
    delete process.env.STRIPE_PORTAL_CONFIGURATION_ID;
  });

  it('deep-links into the cancel/retention flow when ?flow=cancel and a subscription exists', async () => {
    mockMiddlewareSuccess({ stripeCustomerId: 'cus_123', stripeSubscriptionId: 'sub_789' });
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/mock' });

    const { POST } = await import('./route');
    await POST(makeReq('http://localhost:3000/api/billing/portal?flow=cancel'));

    expect(mockPortalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_123',
        flow_data: expect.objectContaining({
          type: 'subscription_cancel',
          subscription_cancel: { subscription: 'sub_789' },
        }),
      })
    );
  });

  it('does not add the cancel flow when the user has no subscription on file', async () => {
    mockMiddlewareSuccess({ stripeCustomerId: 'cus_123', stripeSubscriptionId: null });
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/mock' });

    const { POST } = await import('./route');
    await POST(makeReq('http://localhost:3000/api/billing/portal?flow=cancel'));

    const callArg = mockPortalCreate.mock.calls[0][0];
    expect(callArg.flow_data).toBeUndefined();
  });

  it('returns 500 when Stripe portal creation fails', async () => {
    mockMiddlewareSuccess({ stripeCustomerId: 'cus_123' });
    mockPortalCreate.mockRejectedValue(new Error('Stripe unavailable'));

    const { captureException } = await import('@/lib/monitoring/sentry-server');
    const { POST } = await import('./route');
    const res = await POST(makeReq());
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toContain('Failed to create billing portal session');
    expect(captureException).toHaveBeenCalled();
  });
});
