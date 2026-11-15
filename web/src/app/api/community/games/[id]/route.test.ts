vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';

// Mock drizzle's `eq`/`and` to return inspectable plain objects so we can assert
// on the composed predicate the route passes to `.where()`. We inspect the
// `.where()` call argument directly (not the `eq` spy identity) so the assertion
// is robust to `vi.resetModules()` re-running this factory on each dynamic import.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: vi.fn((col: unknown, val: unknown) => ({ __eq: [col, val] })),
    and: vi.fn((...conds: unknown[]) => ({ __and: conds })),
  };
});

vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  publishedGames: { id: 'id', title: 'title', description: 'description', slug: 'slug', projectId: 'projectId', userId: 'userId', playCount: 'playCount', cdnUrl: 'cdnUrl', status: 'status', createdAt: 'createdAt' },
  users: { id: 'id', displayName: 'displayName', clerkId: 'clerkId' },
  gameForks: { originalGameId: 'originalGameId', forkedProjectId: 'forkedProjectId', userId: 'userId' },
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
    vi.resetModules();
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
    const forkCountChain = mockDbChain([{ count: 0 }]);
    const forkedFromChain = mockDbChain([]);

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(tagsChain)
        .mockReturnValueOnce(commentsChain)
        .mockReturnValueOnce(ratingChain)
        .mockReturnValueOnce(forkCountChain)
        .mockReturnValueOnce(forkedFromChain),
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
    // Never forked, never a fork (#7858).
    expect(body.game.forkCount).toBe(0);
    expect(body.game.forkedFrom).toBeNull();

    // Security: the detail query MUST constrain to published games so
    // processing/unpublished/removed games are never exposed (#8614, #8638).
    // Assert on the WHERE predicate the route actually composed (status filter),
    // not the drizzle `eq` spy identity — the latter is unreliable across the
    // `vi.resetModules()` in beforeEach.
    expect(JSON.stringify(gameChain.where.mock.calls)).toContain('"__eq":["status","published"]');
  });

  /** Queue the six sequential selects the route runs for a published game. */
  function queueGame(game: Record<string, unknown>, forkCount: number, forkedFromRows: unknown[]) {
    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(mockDbChain([game]))
        .mockReturnValueOnce(mockDbChain([]))
        .mockReturnValueOnce(mockDbChain([]))
        .mockReturnValueOnce(mockDbChain([]))
        .mockReturnValueOnce(mockDbChain([{ count: forkCount }]))
        .mockReturnValueOnce(mockDbChain(forkedFromRows)),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);
    return mockDb;
  }
  const baseGame = {
    id: 'game-2', title: 'Fork Of Something', description: null, slug: 'fork-of-something', projectId: 'proj-2',
    authorId: 'user-2', authorName: 'Forker', playCount: 1, cdnUrl: '/play/clerk_2/fork-of-something',
    status: 'published', createdAt: new Date('2025-01-03'), likeCount: 0, avgRating: 0, ratingCount: 0,
  };

  it('credits a published original with a link built from its creator\'s Clerk id and slug (#7858)', async () => {
    const mockDb = queueGame(baseGame, 3, [{
      originalGameId: 'game-1', originalTitle: 'The Original', originalSlug: 'the-original',
      originalAuthorClerkId: 'user_clerkOriginal', originalAuthorName: 'Origin Author', originalStatus: 'published',
    }]);

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost:3000/api/community/games/game-2'), { params: Promise.resolve({ id: 'game-2' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.game.forkCount).toBe(3);
    expect(body.game.forkedFrom).toEqual({
      gameId: 'game-1', title: 'The Original', slug: 'the-original',
      authorClerkId: 'user_clerkOriginal', authorName: 'Origin Author',
    });
    // The attribution lookup keys on THIS game's project id.
    const forkedFromChain = mockDb.select.mock.results[5].value;
    expect(JSON.stringify(forkedFromChain.where.mock.calls[0][0])).toContain('proj-2');
  });

  it('never exposes a taken-down original through a fork: all fields null, unavailable: true', async () => {
    queueGame(baseGame, 0, [{
      originalGameId: 'game-1', originalTitle: 'Removed Game', originalSlug: 'removed-game',
      originalAuthorClerkId: 'user_clerkOriginal', originalAuthorName: 'Origin Author', originalStatus: 'unpublished',
    }]);

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost:3000/api/community/games/game-2'), { params: Promise.resolve({ id: 'game-2' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.game.forkedFrom.unavailable).toBe(true);
    expect(body.game.forkedFrom.gameId).toBeNull();
    expect(body.game.forkedFrom.title).toBeNull();
    expect(body.game.forkedFrom.slug).toBeNull();
    expect(body.game.forkedFrom.authorClerkId).toBeNull();
    expect(body.game.forkedFrom.authorName).toBeNull();
    expect(JSON.stringify(body)).not.toContain('Removed Game');
    expect(JSON.stringify(body)).not.toContain('user_clerkOriginal');
  });

  it('should not leak a non-published (processing/unpublished/removed) game — returns 404', async () => {
    // With the status filter applied, a processing game matches no row → empty result.
    const gameChain = mockDbChain([]);
    const mockDb = { select: vi.fn().mockReturnValue(gameChain) };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/processing-game');
    const res = await GET(req, { params: Promise.resolve({ id: 'processing-game' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Game not found');
    // The status filter is what makes a processing/unpublished game match no row.
    expect(JSON.stringify(gameChain.where.mock.calls)).toContain('"__eq":["status","published"]');
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
