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
  gameRatings: { gameId: 'gameId', userId: 'userId', id: 'id', rating: 'rating' },
}));

describe('POST /api/community/games/[id]/rate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator', displayName: 'Test' } as never },
    });
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 60000 });
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/rate', {
      method: 'POST',
      body: JSON.stringify({ rating: 5 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });

    expect(res.status).toBe(401);
  });

  it('should return 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/rate', {
      method: 'POST',
      body: JSON.stringify({ rating: 5 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });

    expect(res.status).toBe(429);
  });

  it('should return 400 for invalid rating', async () => {
    const mockDb = { select: vi.fn(), insert: vi.fn(), update: vi.fn() };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/rate', {
      method: 'POST',
      body: JSON.stringify({ rating: 0 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Rating must be between 1 and 5');
  });

  it('should return 400 for rating above 5', async () => {
    const mockDb = { select: vi.fn(), insert: vi.fn(), update: vi.fn() };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/rate', {
      method: 'POST',
      body: JSON.stringify({ rating: 6 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Rating must be between 1 and 5');
  });

  it('should create a new rating and return stats', async () => {
    const existingChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const statsChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ avgRating: 4.5, ratingCount: 1 }]),
    };

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(existingChain)
        .mockReturnValueOnce(statsChain),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/rate', {
      method: 'POST',
      body: JSON.stringify({ rating: 5 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.avgRating).toBe(4.5);
    expect(body.ratingCount).toBe(1);
  });
});
