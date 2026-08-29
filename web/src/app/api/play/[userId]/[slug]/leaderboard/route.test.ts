vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, getNeonSql } from '@/lib/db/client';
import { LEADERBOARD_METADATA_MAX_BYTES } from '@/lib/config/databaseLimits';
import { MAX_COMMAND_PAYLOAD_DEPTH } from '@/lib/engine/commandPayloadGuard';

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
const BOARD_DESC: {
  id: string; gameId: string; name: string; sortOrder: string;
  maxEntries: number; minScore: number | null; maxScore: number | null;
} = {
  id: 'board-1', gameId: 'game-1', name: 'highscore',
  sortOrder: 'desc', maxEntries: 100, minScore: null, maxScore: null,
};

// ---------------------------------------------------------------------------
// GET tests
// ---------------------------------------------------------------------------

describe('GET /api/play/[userId]/[slug]/leaderboard', () => {
  beforeEach(() => {
    vi.resetModules();
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
    vi.resetModules();
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
  function makePostDb(board = BOARD_DESC) {
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

  // -------------------------------------------------------------------------
  // PF-9447 — input bounds enforced before any DB access
  //
  // `score` lands in an int4 column and `metadata` in a jsonb column, on an
  // unauthenticated route. Every test below asserts the status AND that the
  // handler never reached the database: a guard that runs after the board
  // lookup still lets a malformed request cost a query, and one that runs
  // after the INSERT turns a 400 into a captureException plus a 500, which is
  // the defect being fixed. `getDb` and `getNeonSql` are given fully working
  // mocks in the rejection tests on purpose — so the only thing that can
  // produce a 400 is the guard, not an incidental mock failure.
  // -------------------------------------------------------------------------

  /** Mount a DB + neonSql pair that would succeed if the handler reached it. */
  function mountWorkingDb(board = BOARD_DESC) {
    vi.mocked(getDb).mockReturnValue(makePostDb(board) as never);
    const neon = makeNeonSqlFn();
    vi.mocked(getNeonSql).mockReturnValue(neon as never);
    return neon;
  }

  function postScore(body: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/play/clerk_1/mygame', {
      method: 'POST',
      body: JSON.stringify({ name: 'highscore', playerName: 'Alice', ...body }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const PARAMS = { params: Promise.resolve({ userId: 'clerk_1', slug: 'mygame' }) };

  /** Assert the handler bailed out before touching the database. */
  async function expectNoDbAccess() {
    const { captureException } = await import('@/lib/monitoring/sentry-server');
    expect(getDb).not.toHaveBeenCalled();
    expect(getNeonSql).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  }

  it('accepts a score of exactly 2147483647 (int4 max)', async () => {
    mountWorkingDb();

    const { POST } = await import('./route');
    const res = await POST(postScore({ score: 2147483647 }), PARAMS);

    expect(res.status).toBe(201);
  });

  it('accepts a score of exactly -2147483648 (int4 min)', async () => {
    mountWorkingDb();

    const { POST } = await import('./route');
    const res = await POST(postScore({ score: -2147483648 }), PARAMS);

    expect(res.status).toBe(201);
  });

  it('returns 400 for a score of 2147483648, one past int4 max', async () => {
    mountWorkingDb();

    const { POST } = await import('./route');
    const res = await POST(postScore({ score: 2147483648 }), PARAMS);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('score must be between -2147483648 and 2147483647');
    await expectNoDbAccess();
  });

  it('returns 400 for a score of -2147483649, one past int4 min', async () => {
    mountWorkingDb();

    const { POST } = await import('./route');
    const res = await POST(postScore({ score: -2147483649 }), PARAMS);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('score must be between -2147483648 and 2147483647');
    await expectNoDbAccess();
  });

  it('returns 400 for score 3000000000 on a board with no minScore/maxScore', async () => {
    // BOARD_DESC leaves both bounds null — the case the per-board check cannot
    // catch, and the exact shape that used to reach Postgres and 500.
    expect(BOARD_DESC.minScore).toBeNull();
    expect(BOARD_DESC.maxScore).toBeNull();
    mountWorkingDb();

    const { POST } = await import('./route');
    const res = await POST(postScore({ score: 3000000000 }), PARAMS);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('2147483647');
    await expectNoDbAccess();
  });

  it('returns 400 for score -3000000000 on a board with no minScore/maxScore', async () => {
    mountWorkingDb();

    const { POST } = await import('./route');
    const res = await POST(postScore({ score: -3000000000 }), PARAMS);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('-2147483648');
    await expectNoDbAccess();
  });

  it('returns 400 for score 3000000000 even when the board sets a wide minScore/maxScore', async () => {
    // The int4 bound is a property of the column, not of the board, so it must
    // hold whether or not the board configured its own range.
    mountWorkingDb({ ...BOARD_DESC, minScore: -100000, maxScore: 100000 });

    const { POST } = await import('./route');
    const res = await POST(postScore({ score: 3000000000 }), PARAMS);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('2147483647');
    // Refused before the board was even fetched, so the board's own bounds
    // played no part in the decision.
    await expectNoDbAccess();
  });

  it('rounds a float at the int4 boundary rather than rejecting it', async () => {
    // 2147483647.4 rounds down to exactly int4 max — the guard runs on the
    // rounded value, which is what actually gets inserted.
    const neon = mountWorkingDb();

    const { POST } = await import('./route');
    const res = await POST(postScore({ score: 2147483647.4 }), PARAMS);

    expect(res.status).toBe(201);
    expect(neon.mock.calls[0].slice(1)).toContain(2147483647);
  });

  // ---- metadata bounds --------------------------------------------------

  /** Build `{ pad: '…' }` whose JSON serialization is exactly `bytes` long. */
  function metadataOfBytes(bytes: number) {
    const envelope = JSON.stringify({ pad: '' }).length; // 10
    return { pad: 'a'.repeat(bytes - envelope) };
  }

  it('documents the metadata byte cap as 4 KiB', () => {
    // The cap is quoted in the 400 message and in the route's docs; pin it so a
    // silent change has to be a deliberate one.
    expect(LEADERBOARD_METADATA_MAX_BYTES).toBe(4096);
  });

  it('accepts metadata whose serialization is exactly at the byte cap', async () => {
    const neon = mountWorkingDb();
    const metadata = metadataOfBytes(LEADERBOARD_METADATA_MAX_BYTES);
    expect(Buffer.byteLength(JSON.stringify(metadata), 'utf8')).toBe(LEADERBOARD_METADATA_MAX_BYTES);

    const { POST } = await import('./route');
    const res = await POST(postScore({ score: 1500, metadata }), PARAMS);

    expect(res.status).toBe(201);
    // The at-cap blob is the one actually handed to the INSERT — not silently
    // dropped on the way through.
    expect(neon.mock.calls[0].slice(1)).toContain(JSON.stringify(metadata));
  });

  it('returns 400 for metadata one byte over the cap', async () => {
    mountWorkingDb();
    const metadata = metadataOfBytes(LEADERBOARD_METADATA_MAX_BYTES + 1);

    const { POST } = await import('./route');
    const res = await POST(postScore({ score: 1500, metadata }), PARAMS);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe(
      `metadata is too large (${LEADERBOARD_METADATA_MAX_BYTES + 1} bytes; limit is ${LEADERBOARD_METADATA_MAX_BYTES} bytes)`
    );
    await expectNoDbAccess();
  });

  it('counts the metadata cap in UTF-8 bytes, not UTF-16 code units', async () => {
    // A 3-byte character costs 3 against the cap even though `String.length`
    // counts it as 1 — the column stores bytes.
    mountWorkingDb();
    const chars = LEADERBOARD_METADATA_MAX_BYTES; // well under the cap by .length
    const metadata = { pad: '中'.repeat(Math.ceil(chars / 3)) };
    expect(JSON.stringify(metadata).length).toBeLessThanOrEqual(LEADERBOARD_METADATA_MAX_BYTES);
    expect(Buffer.byteLength(JSON.stringify(metadata), 'utf8')).toBeGreaterThan(
      LEADERBOARD_METADATA_MAX_BYTES
    );

    const { POST } = await import('./route');
    const res = await POST(postScore({ score: 1500, metadata }), PARAMS);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('too large');
    await expectNoDbAccess();
  });

  it('returns 400 for metadata nested past the payload-guard depth limit', async () => {
    mountWorkingDb();

    // Well past MAX_COMMAND_PAYLOAD_DEPTH (32) but only a few hundred bytes, so
    // a pass here proves the depth guard fired and not the size guard.
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 40; i += 1) deep = { nested: deep };
    expect(Buffer.byteLength(JSON.stringify(deep), 'utf8')).toBeLessThan(
      LEADERBOARD_METADATA_MAX_BYTES
    );

    const { POST } = await import('./route');
    const res = await POST(postScore({ score: 1500, metadata: deep }), PARAMS);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('nested too deeply');
    await expectNoDbAccess();
  });

  it('accepts metadata nested up to the payload-guard depth limit', async () => {
    mountWorkingDb();

    // Depth is 1-based: the outer object is level 1, so 31 wrappers around a
    // scalar leaf reaches exactly MAX_COMMAND_PAYLOAD_DEPTH.
    let shallow: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < MAX_COMMAND_PAYLOAD_DEPTH - 2; i += 1) shallow = { nested: shallow };

    const { POST } = await import('./route');
    const res = await POST(postScore({ score: 1500, metadata: shallow }), PARAMS);

    expect(res.status).toBe(201);
  });

  it('accepts a submission with metadata omitted and stores SQL NULL', async () => {
    const neon = mountWorkingDb();

    const { POST } = await import('./route');
    const res = await POST(postScore({ score: 1500 }), PARAMS);

    expect(res.status).toBe(201);
    // The metadata bind value is null — nothing is invented for the jsonb cast.
    expect(neon.mock.calls[0].slice(1)).toContain(null);
  });
});
