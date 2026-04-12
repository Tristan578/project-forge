vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { makeUser } from '@/test/utils/apiTestUtils';
import { getDb } from '@/lib/db/client';

vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_PRICE_STARTER = 'price_starter_mock';
  process.env.STRIPE_PRICE_CREATOR = 'price_creator_mock';
  process.env.STRIPE_PRICE_STUDIO = 'price_studio_mock';
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
});

vi.mock('@/lib/api/middleware');
vi.mock('@/lib/db/client');
vi.mock('@/lib/logging/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

// Mock Stripe — capture constructor args to verify apiVersion
const { mockCustomerCreate, mockCheckoutCreate, capturedStripeOpts } = vi.hoisted(() => ({
  mockCustomerCreate: vi.fn(),
  mockCheckoutCreate: vi.fn(),
  capturedStripeOpts: { value: null as { apiVersion: string } | null },
}));

vi.mock('stripe', () => {
  return {
    default: class MockStripe {
      customers = { create: mockCustomerCreate };
      checkout = { sessions: { create: mockCheckoutCreate } };
      constructor(_key: string, opts: { apiVersion: string }) {
        capturedStripeOpts.value = opts;
      }
    },
  };
});

function makeReq(body?: unknown) {
  const url = 'http://localhost:3000/api/billing/checkout';
  if (body !== undefined) {
    return new NextRequest(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new NextRequest(url, { method: 'POST' });
}

function mockMiddlewareSuccess(overrides?: Partial<ReturnType<typeof makeUser>>) {
  const user = makeUser(overrides);
  vi.mocked(withApiMiddleware).mockImplementation(async (req) => {
    let body: unknown = undefined;
    try {
      body = await req.clone().json();
    } catch {
      body = undefined;
    }
    return {
      error: undefined,
      userId: user.id,
      authContext: { clerkId: 'clerk123', user } as never,
      body,
    };
  });
  return user;
}

describe('POST /api/billing/checkout', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
    process.env.STRIPE_PRICE_STARTER = 'price_starter_mock';
    process.env.STRIPE_PRICE_CREATOR = 'price_creator_mock';
    process.env.STRIPE_PRICE_STUDIO = 'price_studio_mock';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';

    const mockDb = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(true),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
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
    const res = await POST(makeReq({ tier: 'creator' }));

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
    const res = await POST(makeReq({ tier: 'creator' }));

    expect(res.status).toBe(429);
  });

  it('returns 422 for invalid tier (schema validation via middleware)', async () => {
    const validationResponse = new Response(
      JSON.stringify({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: { tier: { _errors: ['Invalid enum value'] } } }),
      { status: 422 }
    );
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: validationResponse as never,
      userId: null,
      authContext: null,
      body: undefined,
    });

    const { POST } = await import('./route');
    const res = await POST(makeReq({ tier: 'invalid_tier' }));
    const data = await res.json();

    expect(res.status).toBe(422);
    expect(data.error).toBe('Validation failed');
    expect(JSON.stringify(data.details)).toContain('tier');
  });

  it('creates Stripe customer if none exists and starts checkout', async () => {
    const user = mockMiddlewareSuccess({ stripeCustomerId: null });

    mockCustomerCreate.mockResolvedValue({ id: 'cus_new123' });
    mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/mock' });

    const { POST } = await import('./route');
    const res = await POST(makeReq({ tier: 'creator' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.url).toBe('https://checkout.stripe.com/c/pay/mock');

    expect(mockCustomerCreate).toHaveBeenCalledWith({
      email: user.email,
      metadata: { userId: user.id, clerkId: 'clerk123' },
    });

    expect(mockCheckoutCreate).toHaveBeenCalledWith(expect.objectContaining({
      customer: 'cus_new123',
      line_items: [{ price: 'price_creator_mock', quantity: 1 }],
      metadata: { userId: user.id, tier: 'creator' },
    }));
  });

  it('uses existing Stripe customer for checkout', async () => {
    mockMiddlewareSuccess({ stripeCustomerId: 'cus_existing' });

    mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/mock2' });

    const { POST } = await import('./route');
    const res = await POST(makeReq({ tier: 'pro' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.url).toBe('https://checkout.stripe.com/c/pay/mock2');

    expect(mockCustomerCreate).not.toHaveBeenCalled();
    expect(mockCheckoutCreate).toHaveBeenCalledWith(expect.objectContaining({
      customer: 'cus_existing',
      line_items: [{ price: 'price_studio_mock', quantity: 1 }],
    }));
  });

  it('initialises Stripe with the v22 API version', async () => {
    mockMiddlewareSuccess({ stripeCustomerId: 'cus_existing' });
    mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/mock' });

    const { POST } = await import('./route');
    await POST(makeReq({ tier: 'hobbyist' }));

    expect(capturedStripeOpts.value?.apiVersion).toBe('2026-03-25.dahlia');
  });

  it('returns 500 when Stripe checkout creation fails', async () => {
    mockMiddlewareSuccess({ stripeCustomerId: 'cus_existing' });
    mockCheckoutCreate.mockRejectedValue(new Error('Stripe unavailable'));

    const { captureException } = await import('@/lib/monitoring/sentry-server');
    const { POST } = await import('./route');
    const res = await POST(makeReq({ tier: 'creator' }));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toContain('Failed to create checkout session');
    expect(captureException).toHaveBeenCalled();
  });
});
