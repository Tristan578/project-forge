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
  assetPurchases: { buyerId: 'buyerId', assetId: 'assetId' },
  assetReviews: { id: 'id', assetId: 'assetId', userId: 'userId', rating: 'rating', content: 'content' },
  marketplaceAssets: { id: 'id', avgRating: 'avgRating', ratingCount: 'ratingCount' },
}));

describe('POST /api/marketplace/assets/[id]/review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as never },
    });
    vi.mocked(rateLimit).mockReturnValue({ allowed: true, remaining: 19, resetAt: Date.now() + 60000 });
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/review', {
      method: 'POST',
      body: JSON.stringify({ rating: 5 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(401);
  });

  it('should return 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/review', {
      method: 'POST',
      body: JSON.stringify({ rating: 5 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(429);
  });

  it('should return 400 for invalid rating', async () => {
    const mockDb = { select: vi.fn() };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/review', {
      method: 'POST',
      body: JSON.stringify({ rating: 0 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Rating must be');
  });

  it('should return 403 when asset not purchased', async () => {
    const purchaseChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(purchaseChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/review', {
      method: 'POST',
      body: JSON.stringify({ rating: 5, content: 'Great!' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('Must purchase asset before reviewing');
  });

  it('should create a review and recalculate rating', async () => {
    // Purchase check
    const purchaseChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'p1' }]),
    };
    // Existing review check
    const existingReviewChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    // Get all reviews for avg calculation
    const allReviewsChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ rating: 5 }, { rating: 4 }]),
    };

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(purchaseChain)
        .mockReturnValueOnce(existingReviewChain)
        .mockReturnValueOnce(allReviewsChain),
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
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/review', {
      method: 'POST',
      body: JSON.stringify({ rating: 5, content: 'Great asset!' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
