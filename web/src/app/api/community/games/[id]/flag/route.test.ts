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
  gameComments: { id: 'id', gameId: 'gameId', flagged: 'flagged' },
}));

describe('POST /api/community/games/[id]/flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator', displayName: 'Test' } as never },
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
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/flag', {
      method: 'POST',
      body: JSON.stringify({ commentId: 'c1' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });

    expect(res.status).toBe(401);
  });

  it('should return 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/flag', {
      method: 'POST',
      body: JSON.stringify({ commentId: 'c1' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });

    expect(res.status).toBe(429);
  });

  it('should return 400 when commentId is missing', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/flag', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('commentId is required');
  });

  it('should return 404 when comment not found', async () => {
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
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/flag', {
      method: 'POST',
      body: JSON.stringify({ commentId: 'nonexistent' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Comment not found');
  });

  it('should flag a comment successfully', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'c1', flagged: 0 }]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/flag', {
      method: 'POST',
      body: JSON.stringify({ commentId: 'c1' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.flagged).toBe(true);
  });
});
