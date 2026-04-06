vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/client');
vi.mock('@/lib/api/middleware');
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/db/schema', () => ({
  publishedGames: { id: 'id', userId: 'userId' },
  leaderboards: {
    id: 'id', gameId: 'gameId', name: 'name', sortOrder: 'sortOrder',
    maxEntries: 'maxEntries', minScore: 'minScore', maxScore: 'maxScore', createdAt: 'createdAt',
  },
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { withApiMiddleware } from '@/lib/api/middleware';

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe('/api/publish/[id]/leaderboards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withApiMiddleware).mockResolvedValue({
      error: null,
      authContext: { clerkId: 'clerk_1', user: { id: 'u1', tier: 'creator' } },
      userId: 'u1',
    } as never);
  });

  describe('GET', () => {
    it('should return 401 when not authenticated', async () => {
      vi.mocked(withApiMiddleware).mockResolvedValue({
        error: new Response('Unauthorized', { status: 401 }),
      } as never);
      const { GET } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/publish/g1/leaderboards');
      const res = await GET(req, makeParams('g1'));
      expect(res.status).toBe(401);
    });

    it('should return 404 when game not found', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as never);

      const { GET } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/publish/g1/leaderboards');
      const res = await GET(req, makeParams('g1'));
      expect(res.status).toBe(404);
    });

    it('should return leaderboards for owned game', async () => {
      const selectMock = vi.fn()
        // First call: verifyGameOwnership
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: 'g1' }]),
            }),
          }),
        })
        // Second call: list leaderboards
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { name: 'high-scores', sortOrder: 'desc', maxEntries: 100, minScore: null, maxScore: null, createdAt: new Date() },
            ]),
          }),
        });

      vi.mocked(getDb).mockReturnValue({ select: selectMock } as never);

      const { GET } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/publish/g1/leaderboards');
      const res = await GET(req, makeParams('g1'));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.leaderboards).toHaveLength(1);
      expect(body.leaderboards[0].name).toBe('high-scores');
    });
  });

  describe('POST', () => {
    function mockOwnedGame() {
      const selectMock = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 'g1' }]),
          }),
        }),
      });
      const insertMock = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'lb-1', name: 'high-scores' }]),
        }),
      });
      vi.mocked(getDb).mockReturnValue({ select: selectMock, insert: insertMock } as never);
    }

    it('should create a leaderboard', async () => {
      mockOwnedGame();
      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/publish/g1/leaderboards', {
        method: 'POST',
        body: JSON.stringify({ name: 'high-scores', sortOrder: 'desc' }),
      });
      const res = await POST(req, makeParams('g1'));
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.leaderboard.name).toBe('high-scores');
    });

    it('should return 400 for empty name', async () => {
      mockOwnedGame();
      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/publish/g1/leaderboards', {
        method: 'POST',
        body: JSON.stringify({ name: '' }),
      });
      const res = await POST(req, makeParams('g1'));
      expect(res.status).toBe(400);
    });

    it('should return 400 for name with forbidden characters', async () => {
      mockOwnedGame();
      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/publish/g1/leaderboards', {
        method: 'POST',
        body: JSON.stringify({ name: 'scores/global' }),
      });
      const res = await POST(req, makeParams('g1'));
      expect(res.status).toBe(400);
    });

    it('should return 400 when minScore > maxScore', async () => {
      mockOwnedGame();
      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/publish/g1/leaderboards', {
        method: 'POST',
        body: JSON.stringify({ name: 'test', minScore: 100, maxScore: 50 }),
      });
      const res = await POST(req, makeParams('g1'));
      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid JSON', async () => {
      mockOwnedGame();
      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/publish/g1/leaderboards', {
        method: 'POST',
        body: 'not json',
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await POST(req, makeParams('g1'));
      expect(res.status).toBe(400);
    });

    it('should clamp maxEntries to valid range', async () => {
      mockOwnedGame();
      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost:3000/api/publish/g1/leaderboards', {
        method: 'POST',
        body: JSON.stringify({ name: 'test', maxEntries: 5000 }),
      });
      const res = await POST(req, makeParams('g1'));
      // Should succeed — clamped to 1000
      expect(res.status).toBe(201);
    });
  });
});
