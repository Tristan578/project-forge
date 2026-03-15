vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn().mockReturnValue(new Response('Rate Limited', { status: 429 })),
}));

// Mock Stripe
const { mockPortalCreate } = vi.hoisted(() => ({
  mockPortalCreate: vi.fn(),
}));

vi.mock('stripe', () => {
  return {
    default: class MockStripe {
      billingPortal = {
        sessions: {
          create: mockPortalCreate,
        },
      };
    },
  };
});

describe('POST /api/billing/portal', () => {
  const originalSecret = process.env.STRIPE_SECRET_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    
    vi.mocked(rateLimit).mockReturnValue({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60000,
    });
  });

  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = originalSecret;
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const _req = new Request('http://localhost/api/billing/portal', { method: 'POST' });
    const res = await POST();

    expect(res.status).toBe(401);
  });

  it('returns 429 if rate limited', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(rateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const res = await POST();
    expect(res.status).toBe(429);
  });

  it('returns 400 if user has no Stripe customer ID', async () => {
    const user = makeUser({ stripeCustomerId: null });
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

    const res = await POST();
    const data = await res.json();
    
    expect(res.status).toBe(400);
    expect(data.error).toContain('No Stripe customer found');
  });

  it('returns billing portal URL for valid customer', async () => {
    const user = makeUser({ stripeCustomerId: 'cus_123' });
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/mock' });

    const res = await POST();
    const data = await res.json();
    
    expect(res.status).toBe(200);
    expect(data.url).toBe('https://billing.stripe.com/p/session/mock');
    expect(mockPortalCreate).toHaveBeenCalledWith({
      customer: 'cus_123',
      return_url: 'http://localhost:3000/dashboard',
    });
  });
});
