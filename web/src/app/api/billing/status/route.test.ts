import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { makeUser } from '@/test/utils/apiTestUtils';

vi.mock('@/lib/auth/api-auth', () => ({
  authenticateRequest: vi.fn(),
}));

describe('GET /api/billing/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it('returns current tier and billing status for authenticated user', async () => {
    const cycleStart = new Date('2026-03-01T12:00:00Z');
    const user = makeUser({
      tier: 'pro',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      billingCycleStart: cycleStart,
    });

    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true,
      ctx: { clerkId: 'clerk_123', user },
    });

    const res = await GET();
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
    const user = makeUser({
      tier: 'starter',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      billingCycleStart: null,
    });

    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true,
      ctx: { clerkId: 'clerk_123', user },
    });

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.tier).toBe('starter');
    expect(data.stripeCustomerId).toBeNull();
    expect(data.stripeSubscriptionId).toBeNull();
    expect(data.billingCycleStart).toBeNull();
    expect(data.nextRefillDate).toBeNull();
  });
});
