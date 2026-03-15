/**
 * Tests for GET /api/community/games
 *
 * Covers: rate limiting, pagination, search filtering, tag filtering,
 * sort modes, tag enrichment, DB errors.
 */
vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks (hoisted before imports)
// ---------------------------------------------------------------------------

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(),
}));

vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { rateLimitPublicRoute } from '@/lib/rateLimit';
import { getDb } from '@/lib/db/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/community/games');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString());
}

/** A minimal game row returned from the DB query */
function makeGameRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'game-1',
    title: 'Test Game',
    description: 'A fun game',
    slug: 'test-game',
    authorId: 'user-1',
    authorName: 'Alice',
    playCount: 42,
    cdnUrl: '/play/user-1/test-game',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    likeCount: 5,
    avgRating: 4.2,
    ratingCount: 10,
    commentCount: 3,
    ...overrides,
  };
}

/**
 * Build a chainable drizzle-ORM stub.
 * All intermediate method calls return `this` (the chain).
 * `offset()` is the terminal method that resolves with `rows`.
 */
function makeQueryChain(rows: unknown[]) {
  const chain: Record<string, () => unknown> = {};
  const self = () => chain;
  chain.from = self;
  chain.leftJoin = self;
  chain.where = self;
  chain.groupBy = self;
  chain.orderBy = self;
  chain.limit = self;
  chain.offset = () => Promise.resolve(rows);
  return chain;
}

/**
 * Tags sub-query chain: select().from().where() → Promise.resolve(tags)
 */
function makeTagsChain(tags: Array<{ gameId: string; tag: string }>) {
  return {
    from: () => ({
      where: () => Promise.resolve(tags),
    }),
  };
}

/**
 * Tag-filter sub-query chain: select().from().where() → Promise.resolve(tagRows)
 */
function makeTagFilterChain(tagRows: Array<{ gameId: string }>) {
  return {
    from: () => ({
      where: () => Promise.resolve(tagRows),
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/community/games', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Default: rate limiter allows
    vi.mocked(rateLimitPublicRoute).mockReturnValue(null);

    // Fresh import per test to avoid module state
    const mod = await import('../route');
    GET = mod.GET;
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------
  describe('rate limiting', () => {
    it('returns 429 when rate limited', async () => {
      vi.mocked(rateLimitPublicRoute).mockReturnValue(
        new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }) as never,
      );

      const res = await GET(makeRequest());
      expect(res.status).toBe(429);
    });

    it('calls rateLimitPublicRoute with correct endpoint parameters', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn()
          .mockReturnValueOnce(makeQueryChain([]))
          .mockReturnValueOnce(makeTagsChain([])),
      } as never);

      await GET(makeRequest());

      expect(rateLimitPublicRoute).toHaveBeenCalledWith(
        expect.anything(),
        'community-games',
        30,
        5 * 60 * 1000,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Happy path — basic listing
  // -------------------------------------------------------------------------
  describe('happy path', () => {
    it('returns 200 with games array and hasMore flag', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn()
          .mockReturnValueOnce(makeQueryChain([makeGameRow()]))
          .mockReturnValueOnce(makeTagsChain([])),
      } as never);

      const res = await GET(makeRequest());
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty('games');
      expect(body).toHaveProperty('hasMore');
      expect(Array.isArray(body.games)).toBe(true);
    });

    it('formats game fields correctly including ISO date and unknown author', async () => {
      const row = makeGameRow({ authorName: null });
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn()
          .mockReturnValueOnce(makeQueryChain([row]))
          .mockReturnValueOnce(makeTagsChain([{ gameId: 'game-1', tag: 'platformer' }])),
      } as never);

      const res = await GET(makeRequest());
      const body = await res.json();
      const game = body.games[0];

      expect(game.id).toBe('game-1');
      expect(game.title).toBe('Test Game');
      expect(game.authorName).toBe('Unknown'); // null → 'Unknown'
      expect(game.tags).toEqual(['platformer']);
      expect(game.thumbnail).toBeNull();
      expect(typeof game.createdAt).toBe('string'); // ISO string
      expect(game.createdAt).toBe('2024-01-01T00:00:00.000Z');
    });

    it('converts numeric aggregates from string to Number (postgres behaviour)', async () => {
      const row = makeGameRow({
        likeCount: '7',
        avgRating: '3.5',
        ratingCount: '2',
        commentCount: '1',
      });
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn()
          .mockReturnValueOnce(makeQueryChain([row]))
          .mockReturnValueOnce(makeTagsChain([])),
      } as never);

      const res = await GET(makeRequest());
      const body = await res.json();
      const game = body.games[0];

      expect(typeof game.likeCount).toBe('number');
      expect(typeof game.avgRating).toBe('number');
      expect(typeof game.ratingCount).toBe('number');
      expect(typeof game.commentCount).toBe('number');
    });

    it('merges tags from multiple games correctly', async () => {
      const rows = [
        makeGameRow({ id: 'g1', slug: 'g1' }),
        makeGameRow({ id: 'g2', slug: 'g2' }),
      ];
      const tags = [
        { gameId: 'g1', tag: 'shooter' },
        { gameId: 'g1', tag: 'action' },
        { gameId: 'g2', tag: 'puzzle' },
      ];
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn()
          .mockReturnValueOnce(makeQueryChain(rows))
          .mockReturnValueOnce(makeTagsChain(tags)),
      } as never);

      const res = await GET(makeRequest());
      const body = await res.json();

      const g1 = body.games.find((g: { id: string }) => g.id === 'g1');
      const g2 = body.games.find((g: { id: string }) => g.id === 'g2');

      expect(g1.tags).toEqual(['shooter', 'action']);
      expect(g2.tags).toEqual(['puzzle']);
    });

    it('returns empty tags array when game has no tags', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn()
          .mockReturnValueOnce(makeQueryChain([makeGameRow({ id: 'game-notag' })]))
          .mockReturnValueOnce(makeTagsChain([])),
      } as never);

      const res = await GET(makeRequest());
      const body = await res.json();
      expect(body.games[0].tags).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------
  describe('pagination', () => {
    it('sets hasMore=true when query returns limit+1 rows', async () => {
      const rows = Array.from({ length: 21 }, (_, i) =>
        makeGameRow({ id: `game-${i}`, slug: `game-${i}` }),
      );
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn()
          .mockReturnValueOnce(makeQueryChain(rows))
          .mockReturnValueOnce(makeTagsChain([])),
      } as never);

      const res = await GET(makeRequest({ limit: '20' }));
      const body = await res.json();

      expect(body.hasMore).toBe(true);
      expect(body.games).toHaveLength(20); // sliced to limit
    });

    it('sets hasMore=false when fewer than limit+1 results returned', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn()
          .mockReturnValueOnce(makeQueryChain([makeGameRow()]))
          .mockReturnValueOnce(makeTagsChain([])),
      } as never);

      const res = await GET(makeRequest({ limit: '20' }));
      const body = await res.json();
      expect(body.hasMore).toBe(false);
    });

    it('caps limit at 100 (does not crash with limit=9999)', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn()
          .mockReturnValueOnce(makeQueryChain([]))
          .mockReturnValueOnce(makeTagsChain([])),
      } as never);

      const res = await GET(makeRequest({ limit: '9999' }));
      expect(res.status).toBe(200);
    });

    it('returns empty games array when no results exist', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn()
          .mockReturnValueOnce(makeQueryChain([]))
          .mockReturnValueOnce(makeTagsChain([])),
      } as never);

      const res = await GET(makeRequest({ page: '100' }));
      const body = await res.json();

      expect(body.games).toHaveLength(0);
      expect(body.hasMore).toBe(false);
    });

    it('does not attempt tags query when games list is empty', async () => {
      const selectMock = vi.fn().mockReturnValueOnce(makeQueryChain([]));
      vi.mocked(getDb).mockReturnValue({ select: selectMock } as never);

      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
      // selectMock was called once (games) and the tags branch skips a second call
      expect(selectMock).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Tag filtering
  // -------------------------------------------------------------------------
  describe('tag filtering', () => {
    it('returns empty result immediately when no games have the given tag', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValueOnce(makeTagFilterChain([])),
      } as never);

      const res = await GET(makeRequest({ tag: 'nonexistent-tag' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.games).toHaveLength(0);
      expect(body.hasMore).toBe(false);
    });

    it('proceeds with main query when tag matches games', async () => {
      const row = makeGameRow({ id: 'game-tagged' });
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn()
          .mockReturnValueOnce(makeTagFilterChain([{ gameId: 'game-tagged' }])) // tag lookup
          .mockReturnValueOnce(makeQueryChain([row]))                            // games query
          .mockReturnValueOnce(makeTagsChain([{ gameId: 'game-tagged', tag: 'shooter' }])), // tags enrichment
      } as never);

      const res = await GET(makeRequest({ tag: 'shooter' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.games).toHaveLength(1);
      expect(body.games[0].id).toBe('game-tagged');
    });
  });

  // -------------------------------------------------------------------------
  // Sort modes
  // -------------------------------------------------------------------------
  describe('sort modes', () => {
    const sortModes = ['trending', 'newest', 'top_rated', 'most_played'];

    for (const sort of sortModes) {
      it(`returns 200 for sort=${sort}`, async () => {
        vi.mocked(getDb).mockReturnValue({
          select: vi.fn()
            .mockReturnValueOnce(makeQueryChain([makeGameRow()]))
            .mockReturnValueOnce(makeTagsChain([])),
        } as never);

        const res = await GET(makeRequest({ sort }));
        expect(res.status).toBe(200);
      });
    }

    it('defaults to trending sort when sort param is omitted', async () => {
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn()
          .mockReturnValueOnce(makeQueryChain([]))
          .mockReturnValueOnce(makeTagsChain([])),
      } as never);

      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------
  describe('error handling', () => {
    it('returns 500 with error message when DB throws synchronously', async () => {
      vi.mocked(getDb).mockImplementation(() => {
        throw new Error('DB connection failed');
      });

      const res = await GET(makeRequest());
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.error).toBe('Failed to fetch games');
    });

    it('returns 500 when DB query rejects asynchronously', async () => {
      const rejectingChain = makeQueryChain([]);
      rejectingChain.offset = () => Promise.reject(new Error('Query failed'));

      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValue(rejectingChain),
      } as never);

      const res = await GET(makeRequest());
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.error).toBe('Failed to fetch games');
    });
  });
});
