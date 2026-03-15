vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
}));
vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  users: { id: 'id', earnedCredits: 'earnedCredits', addonTokens: 'addonTokens', monthlyTokens: 'monthlyTokens', monthlyTokensUsed: 'monthlyTokensUsed' },
  marketplaceAssets: { id: 'id', sellerId: 'sellerId', status: 'status', priceTokens: 'priceTokens', downloadCount: 'downloadCount', assetFileUrl: 'assetFileUrl', license: 'license' },
  assetPurchases: { buyerId: 'buyerId', assetId: 'assetId', priceTokens: 'priceTokens', license: 'license' },
  creditTransactions: { userId: 'userId', transactionType: 'transactionType', amount: 'amount', balanceAfter: 'balanceAfter', source: 'source', referenceId: 'referenceId' },
}));

const mockUser = {
  id: 'user_1',
  tier: 'creator',
  displayName: 'Test',
  monthlyTokens: 1000,
  monthlyTokensUsed: 0,
  addonTokens: 500,
  earnedCredits: 200,
  stripeCustomerId: null,
  email: 'test@test.com',
};

describe('POST /api/marketplace/assets/[id]/purchase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: mockUser as never },
    });
    vi.mocked(rateLimit).mockReturnValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 });
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(401);
  });

  it('should return 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(429);
  });

  it('should return 404 when asset not found', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/missing/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'missing' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Asset not found');
  });

  it('should return 400 when already purchased', async () => {
    const assetChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', status: 'published', sellerId: 'other-user', priceTokens: 100, assetFileUrl: 'url', license: 'standard', downloadCount: 0 }]),
    };
    const purchaseChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'p1' }]),
    };
    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(assetChain)
        .mockReturnValueOnce(purchaseChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Already purchased');
  });

  it('should return 400 when buying own asset', async () => {
    const assetChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', status: 'published', sellerId: 'user_1', priceTokens: 100 }]),
    };
    const purchaseChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(assetChain)
        .mockReturnValueOnce(purchaseChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Cannot purchase your own asset');
  });

  it('should handle free asset purchase', async () => {
    const assetChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'a1', status: 'published', sellerId: 'other', priceTokens: 0, assetFileUrl: 'https://cdn.example.com/file', license: 'standard', downloadCount: 5 }]),
    };
    const purchaseChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(assetChain)
        .mockReturnValueOnce(purchaseChain),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/purchase');
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.downloadUrl).toBe('https://cdn.example.com/file');
  });
});
