vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticateRequest, assertTier } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';

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

describe('POST /api/tokens/purchase', () => {
  beforeEach(() => {
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
    const req = new Request('http://localhost:3000/api/tokens/purchase', {
      method: 'POST',
      body: JSON.stringify({ package: 'spark' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('should return 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const { POST } = await import('./route');
    const req = new Request('http://localhost:3000/api/tokens/purchase', {
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
    const req = new Request('http://localhost:3000/api/tokens/purchase', {
      method: 'POST',
      body: JSON.stringify({ package: 'spark' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it('should return 400 for invalid package', async () => {
    const { POST } = await import('./route');
    const req = new Request('http://localhost:3000/api/tokens/purchase', {
      method: 'POST',
      body: JSON.stringify({ package: 'nonexistent' }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Invalid package');
  });
});
