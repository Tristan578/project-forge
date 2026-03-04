import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  publishedGames: { id: 'id', title: 'title', description: 'description', slug: 'slug', userId: 'userId', playCount: 'playCount', cdnUrl: 'cdnUrl', status: 'status', createdAt: 'createdAt' },
  users: { id: 'id', displayName: 'displayName' },
  gameLikes: { id: 'id', gameId: 'gameId' },
  gameRatings: { id: 'id', gameId: 'gameId', rating: 'rating' },
  gameTags: { gameId: 'gameId', tag: 'tag' },
  gameComments: { id: 'id', gameId: 'gameId', userId: 'userId', content: 'content', parentId: 'parentId', createdAt: 'createdAt', flagged: 'flagged' },
}));

function mockDbChain(data: unknown[] = []) {
  const resolver = vi.fn().mockResolvedValue(data);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  for (const m of ['from', 'leftJoin', 'innerJoin', 'where', 'groupBy', 'orderBy', 'limit', 'offset']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => resolver().then(resolve, reject);
  chain.offset = vi.fn().mockImplementation(() => resolver());
  return chain;
}

describe('GET /api/community/games/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return a game with stats and comments', async () => {
    const mockGame = {
      id: 'game-1', title: 'Test Game', description: 'A description', slug: 'test-game',
      authorId: 'user-1', authorName: 'Author', playCount: 42, cdnUrl: 'https://cdn.example.com/game',
      status: 'published', createdAt: new Date('2025-01-01'), likeCount: 10, avgRating: 4.5, ratingCount: 8,
    };

    const gameChain = mockDbChain([mockGame]);
    const tagsChain = mockDbChain([{ tag: 'puzzle' }, { tag: 'casual' }]);
    const commentsChain = mockDbChain([
      { id: 'c1', content: 'Great game!', parentId: null, createdAt: new Date('2025-01-02'), authorId: 'u2', authorName: 'Commenter' },
    ]);
    const ratingChain = mockDbChain([{ rating: 5, count: 5 }, { rating: 4, count: 3 }]);

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(tagsChain)
        .mockReturnValueOnce(commentsChain)
        .mockReturnValueOnce(ratingChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1');
    const res = await GET(req, { params: Promise.resolve({ id: 'game-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.game.title).toBe('Test Game');
    expect(body.game.tags).toEqual(['puzzle', 'casual']);
    expect(body.game.comments).toHaveLength(1);
    expect(body.game.ratingBreakdown).toHaveLength(5);
  });

  it('should return 404 when game not found', async () => {
    const gameChain = mockDbChain([]);
    const mockDb = {
      select: vi.fn().mockReturnValue(gameChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/missing');
    const res = await GET(req, { params: Promise.resolve({ id: 'missing' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Game not found');
  });

  it('should return 500 on database error', async () => {
    vi.mocked(getDb).mockImplementation(() => { throw new Error('DB error'); });

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1');
    const res = await GET(req, { params: Promise.resolve({ id: 'game-1' }) });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Failed to fetch game');
  });
});
