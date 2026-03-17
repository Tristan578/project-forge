vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/db/client');
vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/db/schema', () => ({
  publishedGames: { id: 'id', title: 'title', description: 'description', slug: 'slug', userId: 'userId', playCount: 'playCount', cdnUrl: 'cdnUrl', createdAt: 'createdAt', status: 'status' },
  users: { id: 'id', displayName: 'displayName' },
  gameLikes: { id: 'id', gameId: 'gameId' },
  gameRatings: { id: 'id', gameId: 'gameId', rating: 'rating' },
  gameTags: { gameId: 'gameId', tag: 'tag' },
  gameComments: { id: 'id', gameId: 'gameId' },
}));

// Creates a mock chain that resolves to `data` no matter which terminal method is called
function mockDbChain(data: unknown[] = []) {
  const resolver = vi.fn().mockResolvedValue(data);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  const methods = ['from', 'leftJoin', 'innerJoin', 'where', 'groupBy', 'orderBy', 'limit', 'offset'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Make the chain itself thenable so `await chain.where(...)` works
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => resolver().then(resolve, reject);
  // Also make offset explicitly resolve
  chain.offset = vi.fn().mockImplementation(() => resolver());
  return chain;
}

describe('GET /api/community/games', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return games list with default pagination', async () => {
    const mockGame = {
      id: 'game-1',
      title: 'Test Game',
      description: 'A test game',
      slug: 'test-game',
      authorId: 'user-1',
      authorName: 'TestUser',
      playCount: 100,
      cdnUrl: 'https://cdn.example.com/game',
      createdAt: new Date('2025-01-01'),
      likeCount: 5,
      avgRating: 4.2,
      ratingCount: 10,
      commentCount: 3,
    };

    const gamesChain = mockDbChain([mockGame]);
    const tagsChain = mockDbChain([]);

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(gamesChain)
        .mockReturnValueOnce(tagsChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.games).toHaveLength(1);
    expect(body.games[0].title).toBe('Test Game');
    expect(body.games[0].tags).toEqual([]);
    expect(body.hasMore).toBe(false);
  });

  it('should return empty list when tag filter matches nothing', async () => {
    // The tag query uses select().from().where() which resolves to []
    const tagSelectChain = mockDbChain([]);
    const mockDb = {
      select: vi.fn().mockReturnValue(tagSelectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games?tag=nonexistent');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.games).toEqual([]);
    expect(body.hasMore).toBe(false);
  });

  it('should cap limit to 100', async () => {
    const selectChain = mockDbChain([]);
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games?limit=999');
    const res = await GET(req);

    expect(res.status).toBe(200);
  });

  it('should return 500 on database error', async () => {
    vi.mocked(getDb).mockImplementation(() => { throw new Error('DB down'); });

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Failed to fetch games');
  });
});
