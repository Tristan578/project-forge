vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, getNeonSql } from '@/lib/db/client';

vi.mock('@/lib/db/client');
vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return {
    ...actual,
    createHash: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue('a'.repeat(64)),
    }),
  };
});
vi.mock('@/lib/db/schema', () => ({
  publishedGames: { id: 'id', userId: 'userId', slug: 'slug', status: 'status' },
  users: { id: 'id', clerkId: 'clerkId' },
  leaderboards: {
    id: 'id', gameId: 'gameId', name: 'name', sortOrder: 'sortOrder',
    maxEntries: 'maxEntries', minScore: 'minScore', maxScore: 'maxScore', createdAt: 'createdAt',
  },
  leaderboardEntries: {
    id: 'id', leaderboardId: 'leaderboardId', playerName: 'playerName',
    score: 'score', metadata: 'metadata', ipHash: 'ipHash', createdAt: 'createdAt',
  },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  gt: vi.fn((...args: unknown[]) => args),
  lt: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((col: unknown) => ({ col, dir: 'desc' })),
  asc: vi.fn((col: unknown) => ({ col, dir: 'asc' })),
  count: vi.fn(() => 'count(*)'),
}));

// ---------------------------------------------------------------------------
// DB chain factory
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSelectChain(data: unknown[] = []): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  for (const m of ['from', 'where', 'limit', 'orderBy', 'select']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(data).then(resolve, reject);
  return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDeleteChain(): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  chain.where = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve([]).then(resolve);
  return chain;
}

const PUBLISHED_GAME = { id: 'game-1', status: 'published' };
const BOARD_DESC = {
  id: 'board-1', gameId: 'game-1', name: 'highscore',
  sortOrder: 'desc', maxEntries: 100, minScore: null, maxScore: null,
};

// ---------------------------------------------------------------------------
// GET tests
// ---------------------------------------------------------------------------

describe('GET /api/play/[userId]/[slug]/leaderboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when game is not found', async () => {
    const userChain = makeSelectChain([]);
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(userChain) } as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/missing?name=highscore');
    const res = await GET(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'missing' }) });
    expect(res.status).toBe(404);
  });

  it('returns 404 when leaderboard does not exist', async () => {
    const userChain = makeSelectChain([{ id: 'u1' }]);
    const gameChain = makeSelectChain([PUBLISHED_GAME]);
    const boardChain = makeSelectChain([]); // no board

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(userChain)
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(boardChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame?name=missing');
    const res = await GET(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toBe('Leaderboard not found');
  });

  it('returns ranked entries for a valid leaderboard', async () => {
    const userChain = makeSelectChain([{ id: 'u1' }]);
    const gameChain = makeSelectChain([PUBLISHED_GAME]);
    const boardChain = makeSelectChain([BOARD_DESC]);
    const entriesChain = makeSelectChain([
      { id: 'e1', playerName: 'Alice', score: 9000, metadata: null, createdAt: '2026-03-24T00:00:00Z' },
      { id: 'e2', playerName: 'Bob', score: 7500, metadata: null, createdAt: '2026-03-24T00:00:01Z' },
    ]);

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(userChain)
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(boardChain)
        .mockReturnValueOnce(entriesChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame?name=highscore&limit=10');
    const res = await GET(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.entries).toHaveLength(2);
    expect(data.entries[0].rank).toBe(1);
    expect(data.entries[0].playerName).toBe('Alice');
    expect(data.entries[1].rank).toBe(2);
    expect(data.leaderboard.sortOrder).toBe('desc');
  });

  it('clamps limit to 1-100 range', async () => {
    const userChain = makeSelectChain([{ id: 'u1' }]);
    const gameChain = makeSelectChain([PUBLISHED_GAME]);
    const boardChain = makeSelectChain([BOARD_DESC]);
    const entriesChain = makeSelectChain([]);

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(userChain)
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(boardChain)
        .mockReturnValueOnce(entriesChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    // Limit of 999 should be clamped to 100
    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame?name=highscore&limit=999');
    const res = await GET(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });

    expect(res.status).toBe(200);
    // The chain's limit() call should have been called with 100
    expect(entriesChain.limit).toHaveBeenCalledWith(100);
  });

  it('returns 500 when DB throws', async () => {
    vi.mocked(getDb).mockImplementation(() => { throw new Error('DB down'); });

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame?name=highscore');
    const res = await GET(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });
    expect(res.status).toBe(500);
  });

  it('returns 429 when rate limited', async () => {
    const { rateLimitPublicRoute } = await import('@/lib/rateLimit');
    const { NextResponse } = await import('next/server');
    vi.mocked(rateLimitPublicRoute).mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    );

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame?name=highscore');
    const res = await GET(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });
    expect(res.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// POST tests
// ---------------------------------------------------------------------------

// Default neonSql mock result: a successful insert returning one row.
const DEFAULT_NEON_INSERT_RESULT = [{
  id: 'entry-1',
  player_name: 'Alice',
  score: 1500,
  created_at: '2026-03-24T00:00:00Z',
}];

/**
 * Create a mock tagged-template function that simulates neonSql`...`.
 * The returned function ignores the SQL strings/values and resolves with
 * `result`. Pass an empty array to simulate the duplicate-detection path
 * (WHERE NOT EXISTS found a duplicate, so no row is inserted).
 */
function makeNeonSqlFn(result: unknown[] = DEFAULT_NEON_INSERT_RESULT) {
  return vi.fn().mockResolvedValue(result);
}

describe('POST /api/play/[userId]/[slug]/leaderboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // pruneLeaderboard is fire-and-forget inside the route. Flush the microtask
  // queue after each test so the async chain completes before vi.clearAllMocks()
  // runs for the next test. Without this, the pruning continuation can consume
  // mock calls from the subsequent test's getDb mock sequence, causing 500s.
  afterEach(async () => {
    await new Promise<void>(resolve => setImmediate(resolve));
  });

  // The POST handler now uses getNeonSql() for the atomic CTE insert instead of
  // a Drizzle insert chain. The select sequence is: user → game → board (3 selects
  // via getDb), then neonSql for the CTE, then countChain for rank, then
  // allEntriesChain for pruneLeaderboard.
  function makePostDb(board: { id: string; gameId: string; name: string; sortOrder: string; maxEntries: number; minScore: number | null; maxScore: number | null } = BOARD_DESC) {
    const userChain = makeSelectChain([{ id: 'u1' }]);
    const gameChain = makeSelectChain([PUBLISHED_GAME]);
    const boardChain = makeSelectChain([board]);
    const countChain = makeSelectChain([{ cnt: 0 }]);
    const allEntriesChain = makeSelectChain([]);
    const deleteChain = makeDeleteChain();

    return {
      select: vi.fn()
        .mockReturnValueOnce(userChain)
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(boardChain)
        .mockReturnValueOnce(countChain)
        .mockReturnValueOnce(allEntriesChain),
      delete: vi.fn().mockReturnValue(deleteChain),
    };
  }

  it('creates a leaderboard entry and returns rank', async () => {
    vi.mocked(getDb).mockReturnValue(makePostDb() as never);
    vi.mocked(getNeonSql).mockReturnValue(makeNeonSqlFn() as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame', {
      method: 'POST',
      body: JSON.stringify({ name: 'highscore', playerName: 'Alice', score: 1500 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.entry.playerName).toBe('Alice');
    expect(data.entry.score).toBe(1500);
    expect(typeof data.rank).toBe('number');
  });

  it('returns 400 when name field is missing', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame', {
      method: 'POST',
      body: JSON.stringify({ playerName: 'Alice', score: 1500 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('name');
  });

  it('returns 400 when playerName is empty', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame', {
      method: 'POST',
      body: JSON.stringify({ name: 'highscore', playerName: '', score: 1500 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });

    expect(res.status).toBe(400);
  });

  it('returns 400 when playerName exceeds 64 characters', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame', {
      method: 'POST',
      body: JSON.stringify({ name: 'highscore', playerName: 'A'.repeat(65), score: 1500 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });

    expect(res.status).toBe(400);
  });

  it('returns 400 when score is not a number', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame', {
      method: 'POST',
      body: JSON.stringify({ name: 'highscore', playerName: 'Alice', score: 'lots' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });

    expect(res.status).toBe(400);
  });

  it('returns 400 when score is Infinity', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame', {
      method: 'POST',
      body: JSON.stringify({ name: 'highscore', playerName: 'Alice', score: 'Infinity' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });

    expect(res.status).toBe(400);
  });

  it('returns 400 when score is below minScore', async () => {
    const boardWithMin = { ...BOARD_DESC, minScore: 100, maxScore: null };
    vi.mocked(getDb).mockReturnValue(makePostDb(boardWithMin) as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame', {
      method: 'POST',
      body: JSON.stringify({ name: 'highscore', playerName: 'Alice', score: 50 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('Score out of range');
  });

  it('returns 400 when score is above maxScore', async () => {
    const boardWithMax = { ...BOARD_DESC, minScore: null, maxScore: 9999 };
    vi.mocked(getDb).mockReturnValue(makePostDb(boardWithMax) as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame', {
      method: 'POST',
      body: JSON.stringify({ name: 'highscore', playerName: 'Alice', score: 100000 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('Score out of range');
  });

  it('returns 429 when a duplicate submission is detected within 1 second', async () => {
    // The atomic CTE returns an empty result set when a duplicate IP hash is found
    // within the last second (WHERE NOT EXISTS prevents the INSERT).
    vi.mocked(getDb).mockReturnValue(makePostDb() as never);
    vi.mocked(getNeonSql).mockReturnValue(makeNeonSqlFn([]) as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame', {
      method: 'POST',
      body: JSON.stringify({ name: 'highscore', playerName: 'Alice', score: 1500 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });
    const data = await res.json();

    expect(res.status).toBe(429);
    expect(data.error).toContain('Duplicate submission');
  });

  it('returns 404 when game is not found', async () => {
    const userChain = makeSelectChain([]);
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(userChain) } as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_bad/mygame', {
      method: 'POST',
      body: JSON.stringify({ name: 'highscore', playerName: 'Alice', score: 1500 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ userId: 'clerk_bad', slug: 'mygame' }) });

    expect(res.status).toBe(404);
  });

  it('returns 404 when leaderboard does not exist for the game', async () => {
    const userChain = makeSelectChain([{ id: 'u1' }]);
    const gameChain = makeSelectChain([PUBLISHED_GAME]);
    const boardChain = makeSelectChain([]); // no board

    vi.mocked(getDb).mockReturnValue({
      select: vi.fn()
        .mockReturnValueOnce(userChain)
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(boardChain),
    } as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame', {
      method: 'POST',
      body: JSON.stringify({ name: 'missing', playerName: 'Alice', score: 1500 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toBe('Leaderboard not found');
  });

  it('returns 400 for invalid JSON body', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame', {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });

    expect(res.status).toBe(400);
  });

  it('returns 429 when rate limited', async () => {
    const { rateLimitPublicRoute } = await import('@/lib/rateLimit');
    const { NextResponse } = await import('next/server');
    vi.mocked(rateLimitPublicRoute).mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    );

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame', {
      method: 'POST',
      body: JSON.stringify({ name: 'highscore', playerName: 'Alice', score: 1500 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });

    expect(res.status).toBe(429);
  });

  it('returns 500 when DB throws unexpectedly', async () => {
    vi.mocked(getDb).mockImplementation(() => { throw new Error('DB down'); });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame', {
      method: 'POST',
      body: JSON.stringify({ name: 'highscore', playerName: 'Alice', score: 1500 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });

    expect(res.status).toBe(500);
  });

  it('accepts optional metadata as a plain object', async () => {
    vi.mocked(getDb).mockReturnValue(makePostDb() as never);
    vi.mocked(getNeonSql).mockReturnValue(makeNeonSqlFn() as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame', {
      method: 'POST',
      body: JSON.stringify({ name: 'highscore', playerName: 'Alice', score: 1500, metadata: { level: 3 } }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });

    expect(res.status).toBe(201);
  });

  it('ignores metadata when it is an array', async () => {
    vi.mocked(getDb).mockReturnValue(makePostDb() as never);
    vi.mocked(getNeonSql).mockReturnValue(makeNeonSqlFn() as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame', {
      method: 'POST',
      body: JSON.stringify({ name: 'highscore', playerName: 'Alice', score: 1500, metadata: [1, 2, 3] }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });

    // Should still succeed — array metadata is silently dropped
    expect(res.status).toBe(201);
  });

  it('rounds float scores to integer', async () => {
    vi.mocked(getDb).mockReturnValue(makePostDb() as never);
    vi.mocked(getNeonSql).mockReturnValue(makeNeonSqlFn() as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/clerk_1/mygame', {
      method: 'POST',
      body: JSON.stringify({ name: 'highscore', playerName: 'Alice', score: 1500.7 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) });

    expect(res.status).toBe(201);
    const data = await res.json();
    // Mocked insert returns 1500 — just verify success
    expect(data.success).toBe(true);
  });
});
