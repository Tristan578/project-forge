vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/api/middleware');
vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(),
  queryWithResilience: vi.fn((fn: () => Promise<unknown>) => fn()),
}));
vi.mock('@/lib/db/schema', () => ({
  assetPurchases: { buyerId: 'buyerId', assetId: 'assetId' },
  assetReviews: { id: 'id', assetId: 'assetId', userId: 'userId', rating: 'rating', content: 'content' },
  marketplaceAssets: { id: 'id', avgRating: 'avgRating', ratingCount: 'ratingCount' },
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/apiValidation', () => ({
  parseJsonBody: vi.fn(),
  requireInteger: vi.fn(),
  optionalString: vi.fn(),
}));

import { withApiMiddleware } from '@/lib/api/middleware';
import { parseJsonBody, requireInteger, optionalString } from '@/lib/apiValidation';

describe('POST /api/marketplace/assets/[id]/review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('should return error when auth fails', async () => {
    const errorResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: errorResponse as never,
      authContext: null,
    } as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/review', {
      method: 'POST',
      body: JSON.stringify({ rating: 5 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    expect(res.status).toBe(401);
  });

  it('should return 400 when body parsing fails', async () => {
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: null,
      authContext: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } },
    } as never);
    const badResponse = new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 });
    vi.mocked(parseJsonBody).mockResolvedValue({ ok: false, response: badResponse } as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/review', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    expect(res.status).toBe(400);
  });

  it('should return 403 when user has not purchased asset', async () => {
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: null,
      authContext: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } },
    } as never);
    vi.mocked(parseJsonBody).mockResolvedValue({ ok: true, body: { rating: 5 } } as never);
    vi.mocked(requireInteger).mockReturnValue({ ok: true, value: 5 } as never);
    vi.mocked(optionalString).mockReturnValue({ ok: true, value: null } as never);

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]), // no purchase found
          }),
        }),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/review', {
      method: 'POST',
      body: JSON.stringify({ rating: 5 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    expect(res.status).toBe(403);
  });

  it('should return 400 when rating is invalid', async () => {
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: null,
      authContext: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } },
    } as never);
    vi.mocked(parseJsonBody).mockResolvedValue({ ok: true, body: { rating: 99 } } as never);
    const badResponse = new Response(JSON.stringify({ error: 'Invalid rating' }), { status: 400 });
    vi.mocked(requireInteger).mockReturnValue({ ok: false, response: badResponse } as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/marketplace/assets/a1/review', {
      method: 'POST',
      body: JSON.stringify({ rating: 99 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'a1' }) });
    expect(res.status).toBe(400);
  });

  it('should create a review and recalculate rating', async () => {
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: null,
      authContext: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } },
    } as never);
    vi.mocked(parseJsonBody).mockResolvedValue({ ok: true, body: { rating: 5, content: 'Great asset!' } } as never);
    vi.mocked(requireInteger).mockReturnValue({ ok: true, value: 5 } as never);
    vi.mocked(optionalString).mockReturnValue({ ok: true, value: 'Great asset!' } as never);

    // The route makes 5 DB calls via queryWithResilience:
    // 1. select purchase (with .limit) → found
    // 2. select existing review (with .limit) → not found
    // 3. insert review (with .onConflictDoNothing)
    // 4. select all reviews for avg (no .limit)
    // 5. update asset avg rating
    let selectCall = 0;
    const makeSelectChain = () => {
      selectCall++;
      const call = selectCall;
      const whereResult = call <= 2
        ? { limit: vi.fn().mockResolvedValue(call === 1 ? [{ id: 'p1' }] : []) }
        : Promise.resolve([{ rating: 5 }, { rating: 4 }]);
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue(whereResult),
        }),
      };
    };

    const mockDb = {
      select: vi.fn().mockImplementation(makeSelectChain),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
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
