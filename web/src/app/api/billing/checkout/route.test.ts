import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_PRICE_STARTER = 'price_starter_mock';
  process.env.STRIPE_PRICE_CREATOR = 'price_creator_mock';
  process.env.STRIPE_PRICE_STUDIO = 'price_studio_mock';
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
});

import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';
import { makeUser } from '@/test/utils/apiTestUtils';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn().mockReturnValue(new Response('Rate Limited', { status: 429 })),
}));
vi.mock('@/lib/db/client');

// Mock Stripe
const { mockCustomerCreate, mockCheckoutCreate } = vi.hoisted(() => ({
  mockCustomerCreate: vi.fn(),
  mockCheckoutCreate: vi.fn(),
}));

vi.mock('stripe', () => {
  return {
    default: class MockStripe {
      customers = { create: mockCustomerCreate };
      checkout = { sessions: { create: mockCheckoutCreate } };
    },
  };
});

describe('POST /api/billing/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock');
    vi.stubEnv('STRIPE_PRICE_STARTER', 'price_starter_mock');
    vi.stubEnv('STRIPE_PRICE_CREATOR', 'price_creator_mock');
    vi.stubEnv('STRIPE_PRICE_STUDIO', 'price_studio_mock');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    
    vi.mocked(rateLimit).mockReturnValue({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60000,
    });

    const mockDb = { update: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(true) };
    vi.mocked(getDb).mockReturnValue(mockDb as ReturnType<typeof getDb>);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: new Response('Unauthorized', { status: 401 }),
    });

    const req = new Request('http://localhost/api/billing/checkout', { method: 'POST', body: JSON.stringify({ tier: 'creator' }) });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('returns 429 if rate limited', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(rateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const req = new Request('http://localhost/api/billing/checkout', { method: 'POST', body: JSON.stringify({ tier: 'creator' }) });
    const res = await POST(req);
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid tier', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

    const req = new Request('http://localhost/api/billing/checkout', { method: 'POST', body: JSON.stringify({ tier: 'invalid_tier' }) });
    const res = await POST(req);
    const data = await res.json();
    
    expect(res.status).toBe(400);
    expect(data.error).toContain('Invalid tier');
  });

  it('creates Stripe customer if none exists and starts checkout', async () => {
    const user = makeUser({ stripeCustomerId: null });
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'clerk123', user } });
    
    mockCustomerCreate.mockResolvedValue({ id: 'cus_new123' });
    mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/mock' });

    const req = new Request('http://localhost/api/billing/checkout', { method: 'POST', body: JSON.stringify({ tier: 'creator' }) });
    const res = await POST(req);
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
    const user = makeUser({ stripeCustomerId: 'cus_existing' });
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'clerk123', user } });
    
    mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/mock2' });

    const req = new Request('http://localhost/api/billing/checkout', { method: 'POST', body: JSON.stringify({ tier: 'pro' }) });
    const res = await POST(req);
    const data = await res.json();
    
    expect(res.status).toBe(200);
    expect(data.url).toBe('https://checkout.stripe.com/c/pay/mock2');
    
    expect(mockCustomerCreate).not.toHaveBeenCalled();
    expect(mockCheckoutCreate).toHaveBeenCalledWith(expect.objectContaining({
      customer: 'cus_existing',
      line_items: [{ price: 'price_studio_mock', quantity: 1 }],
    }));
  });
});
