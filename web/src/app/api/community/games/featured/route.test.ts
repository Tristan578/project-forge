vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/db/client');
vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
}));

function mockRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/community/games/featured');
}
vi.mock('@/lib/db/schema', () => ({
  publishedGames: { id: 'id', title: 'title', description: 'description', slug: 'slug', userId: 'userId', playCount: 'playCount', cdnUrl: 'cdnUrl', createdAt: 'createdAt', status: 'status' },
  users: { id: 'id', displayName: 'displayName' },
  gameLikes: { id: 'id', gameId: 'gameId' },
  gameRatings: { id: 'id', gameId: 'gameId', rating: 'rating' },
  gameTags: { gameId: 'gameId', tag: 'tag' },
  gameComments: { id: 'id', gameId: 'gameId' },
  featuredGames: { gameId: 'gameId', expiresAt: 'expiresAt', position: 'position' },
}));

function mockDbChain(data: unknown[] = []) {
  const resolver = vi.fn().mockResolvedValue(data);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  for (const m of ['from', 'leftJoin', 'innerJoin', 'where', 'groupBy', 'orderBy', 'limit', 'offset']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => resolver().then(resolve, reject);
  return chain;
}

describe('GET /api/community/games/featured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array when no featured games', async () => {
    const featuredChain = mockDbChain([]);
    const mockDb = {
      select: vi.fn().mockReturnValue(featuredChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const res = await GET(mockRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.games).toEqual([]);
  });

  it('should return featured games with stats', async () => {
    const featuredChain = mockDbChain([{ gameId: 'game-1' }]);
    const gamesChain = mockDbChain([{
      id: 'game-1',
      title: 'Featured Game',
      description: 'A featured one',
      slug: 'featured-game',
      authorId: 'u1',
      authorName: 'Author',
      playCount: 500,
      cdnUrl: null,
      createdAt: new Date('2025-01-01'),
      likeCount: 20,
      avgRating: 4.8,
      ratingCount: 15,
      commentCount: 5,
    }]);
    const tagsChain = mockDbChain([{ gameId: 'game-1', tag: 'action' }]);

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(featuredChain)
        .mockReturnValueOnce(gamesChain)
        .mockReturnValueOnce(tagsChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const res = await GET(mockRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.games).toHaveLength(1);
    expect(body.games[0].title).toBe('Featured Game');
    expect(body.games[0].tags).toEqual(['action']);
  });

  it('should return 500 on database error', async () => {
    vi.mocked(getDb).mockImplementation(() => { throw new Error('DB error'); });

    const { GET } = await import('./route');
    const res = await GET(mockRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Failed to fetch featured games');
  });
});
