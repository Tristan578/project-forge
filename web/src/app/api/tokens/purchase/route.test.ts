vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticateRequest, assertTier } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';
import { NextRequest } from 'next/server';

const mockCreateCheckoutSession = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
}));
vi.mock('@/lib/tokens/pricing', () => ({
  TOKEN_PACKAGES: {
    spark: { tokens: 500, price: 499 },
    blaze: { tokens: 2000, price: 1499 },
    inferno: { tokens: 5000, price: 2999 },
  },
}));
vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 4, resetAt: Date.now() + 60000 }),
}));
vi.mock('@/lib/monitoring/sentry-server');
vi.mock('stripe', () => {
  function StripeMock(_key: string, _opts: unknown) {
    return {
      checkout: {
        sessions: { create: mockCreateCheckoutSession },
      },
    };
  }
  return { default: StripeMock };
});

describe('POST /api/tokens/purchase', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: {
        clerkId: 'clerk_1',
        user: {
          id: 'user_1',
          tier: 'creator',
          stripeCustomerId: 'cus_123',
          email: 'test@test.com',
        } as never,
      },
    });
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 4, resetAt: Date.now() + 60000 });
    vi.mocked(assertTier).mockReturnValue(null);
    mockCreateCheckoutSession.mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/pay/cs_test_123',
    });
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRICE_TOKEN_SPARK = 'price_spark';
    process.env.STRIPE_PRICE_TOKEN_BLAZE = 'price_blaze';
    process.env.STRIPE_PRICE_TOKEN_INFERNO = 'price_inferno';
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/tokens/purchase', {
      method: 'POST',
      body: JSON.stringify({ package: 'spark' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('should return 429 when distributed rate limited', async () => {
    const { distributedRateLimit } = await import('@/lib/rateLimit/distributed');
    vi.mocked(distributedRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/tokens/purchase', {
      method: 'POST',
      body: JSON.stringify({ package: 'spark' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(429);
  });

  it('should return 403 for starter tier users', async () => {
    const tierResponse = new Response(JSON.stringify({ error: 'TIER_REQUIRED' }), { status: 403 });
    vi.mocked(assertTier).mockReturnValue(tierResponse as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/tokens/purchase', {
      method: 'POST',
      body: JSON.stringify({ package: 'spark' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it('should return 422 for invalid package (regression: was 400, valid JSON with invalid business value)', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/tokens/purchase', {
      method: 'POST',
      body: JSON.stringify({ package: 'nonexistent' }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toBe('Validation failed');
    expect(JSON.stringify(body.details)).toContain('package');
  });

  it('returns checkoutUrl on successful Stripe checkout session creation', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/tokens/purchase', {
      method: 'POST',
      body: JSON.stringify({ package: 'spark' }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checkoutUrl).toBe('https://checkout.stripe.com/pay/cs_test_123');
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        customer: 'cus_123',
        line_items: [{ price: 'price_spark', quantity: 1 }],
        metadata: expect.objectContaining({ userId: 'user_1', package: 'spark' }),
      })
    );
  });

  it('returns 500 when Stripe throws', async () => {
    mockCreateCheckoutSession.mockRejectedValueOnce(new Error('Stripe network error'));

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/tokens/purchase', {
      method: 'POST',
      body: JSON.stringify({ package: 'blaze' }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain('checkout session');
  });
});
