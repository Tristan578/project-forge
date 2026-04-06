vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockWithApiMiddleware = vi.fn();
vi.mock('@/lib/api/middleware', () => ({
  withApiMiddleware: (...args: unknown[]) => mockWithApiMiddleware(...args),
}));

const mockGetDb = vi.fn();
vi.mock('@/lib/db/client', () => ({
  queryWithResilience: vi.fn((fn: () => unknown) => fn()),
  getDb: () => mockGetDb(),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

vi.mock('@/lib/db/schema', () => ({
  publishedGames: { id: 'id', userId: 'userId' },
  leaderboards: {
    id: 'id', gameId: 'gameId', name: 'name', sortOrder: 'sortOrder',
    maxEntries: 'maxEntries', minScore: 'minScore', maxScore: 'maxScore', createdAt: 'createdAt',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSelectChain(data: unknown[] = []): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  for (const m of ['from', 'where', 'limit', 'select']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(data).then(resolve, reject);
  return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeInsertChain(data: unknown[] = []): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  chain.values = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(data).then(resolve, reject);
  return chain;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  });
}

const GAME = { id: 'game-1' };
const BOARD = { id: 'board-1', name: 'highscore', sortOrder: 'desc', maxEntries: 100, minScore: null, maxScore: null, createdAt: '2026-04-01' };

// ---------------------------------------------------------------------------
// GET /api/publish/[id]/leaderboards
// ---------------------------------------------------------------------------

describe('GET /api/publish/[id]/leaderboards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockWithApiMiddleware.mockResolvedValue({ userId: 'user-1' });
  });

  it('returns 404 when game not owned by user', async () => {
    const gameChain = makeSelectChain([]); // no game
    mockGetDb.mockReturnValue({ select: vi.fn().mockReturnValue(gameChain) });

    const { GET } = await import('../route');
    const res = await GET(
      new NextRequest('http://localhost/api/publish/game-1/leaderboards'),
      makeParams('game-1'),
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Game not found');
  });

  it('returns leaderboard list for valid game', async () => {
    const gameChain = makeSelectChain([GAME]);
    const boardsChain = makeSelectChain([BOARD]);
    mockGetDb.mockReturnValue({
      select: vi.fn()
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(boardsChain),
    });

    const { GET } = await import('../route');
    const res = await GET(
      new NextRequest('http://localhost/api/publish/game-1/leaderboards'),
      makeParams('game-1'),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.leaderboards).toHaveLength(1);
    expect(data.leaderboards[0].name).toBe('highscore');
  });

  it('returns middleware error when not authenticated', async () => {
    mockWithApiMiddleware.mockResolvedValue({ error: new Response('Unauthorized', { status: 401 }) });

    const { GET } = await import('../route');
    const res = await GET(
      new NextRequest('http://localhost/api/publish/game-1/leaderboards'),
      makeParams('game-1'),
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/publish/[id]/leaderboards
// ---------------------------------------------------------------------------

describe('POST /api/publish/[id]/leaderboards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockWithApiMiddleware.mockResolvedValue({ userId: 'user-1' });
  });

  it('returns 404 when game not owned by user', async () => {
    const gameChain = makeSelectChain([]);
    mockGetDb.mockReturnValue({ select: vi.fn().mockReturnValue(gameChain) });

    const { POST } = await import('../route');
    const res = await POST(
      jsonRequest('http://localhost/api/publish/game-1/leaderboards', 'POST', { name: 'test' }),
      makeParams('game-1'),
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 for missing name', async () => {
    const gameChain = makeSelectChain([GAME]);
    mockGetDb.mockReturnValue({ select: vi.fn().mockReturnValue(gameChain) });

    const { POST } = await import('../route');
    const res = await POST(
      jsonRequest('http://localhost/api/publish/game-1/leaderboards', 'POST', {}),
      makeParams('game-1'),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('name is required');
  });

  it('returns 400 for name over 64 characters', async () => {
    const gameChain = makeSelectChain([GAME]);
    mockGetDb.mockReturnValue({ select: vi.fn().mockReturnValue(gameChain) });

    const { POST } = await import('../route');
    const res = await POST(
      jsonRequest('http://localhost/api/publish/game-1/leaderboards', 'POST', { name: 'a'.repeat(65) }),
      makeParams('game-1'),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when minScore > maxScore', async () => {
    const gameChain = makeSelectChain([GAME]);
    mockGetDb.mockReturnValue({ select: vi.fn().mockReturnValue(gameChain) });

    const { POST } = await import('../route');
    const res = await POST(
      jsonRequest('http://localhost/api/publish/game-1/leaderboards', 'POST', {
        name: 'test', minScore: 100, maxScore: 50,
      }),
      makeParams('game-1'),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('minScore must be <= maxScore');
  });

  it('returns 400 for invalid JSON body', async () => {
    const gameChain = makeSelectChain([GAME]);
    mockGetDb.mockReturnValue({ select: vi.fn().mockReturnValue(gameChain) });

    const { POST } = await import('../route');
    const res = await POST(
      new NextRequest('http://localhost/api/publish/game-1/leaderboards', {
        method: 'POST',
        body: 'not json',
        headers: { 'Content-Type': 'application/json' },
      }),
      makeParams('game-1'),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid JSON body');
  });

  it('creates leaderboard with defaults', async () => {
    const gameChain = makeSelectChain([GAME]);
    const insertChain = makeInsertChain([{ id: 'new-1', name: 'scores' }]);
    mockGetDb.mockReturnValue({
      select: vi.fn().mockReturnValue(gameChain),
      insert: vi.fn().mockReturnValue(insertChain),
    });

    const { POST } = await import('../route');
    const res = await POST(
      jsonRequest('http://localhost/api/publish/game-1/leaderboards', 'POST', { name: 'scores' }),
      makeParams('game-1'),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.leaderboard.name).toBe('scores');
  });

  it('returns 409 for duplicate leaderboard name', async () => {
    const gameChain = makeSelectChain([GAME]);
    const insertChain = makeInsertChain([]);
    // Override the returning chain to throw a PG unique violation
    insertChain.then = (_resolve: unknown, reject: (e: unknown) => void) =>
      Promise.reject(Object.assign(new Error('unique_violation'), { code: '23505' })).catch(reject);
    // Need to fix: the route catches this in a try/catch, not in the chain reject
    // Let's make the insert chain throw properly
    mockGetDb.mockReturnValue({
      select: vi.fn().mockReturnValue(gameChain),
      insert: vi.fn().mockImplementation(() => {
        throw Object.assign(new Error('unique_violation'), { code: '23505' });
      }),
    });

    const { POST } = await import('../route');
    const res = await POST(
      jsonRequest('http://localhost/api/publish/game-1/leaderboards', 'POST', { name: 'highscore' }),
      makeParams('game-1'),
    );
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain('already exists');
  });

  it('clamps maxEntries to 1-1000 range', async () => {
    const gameChain = makeSelectChain([GAME]);
    const insertChain = makeInsertChain([{ id: 'new-1', name: 'test' }]);
    const insertMock = vi.fn().mockReturnValue(insertChain);
    mockGetDb.mockReturnValue({
      select: vi.fn().mockReturnValue(gameChain),
      insert: insertMock,
    });

    const { POST } = await import('../route');
    const res = await POST(
      jsonRequest('http://localhost/api/publish/game-1/leaderboards', 'POST', {
        name: 'test', maxEntries: 99999,
      }),
      makeParams('game-1'),
    );
    expect(res.status).toBe(201);
    // Verify clamped value was passed to insert
    const valuesCall = insertChain.values.mock.calls[0][0];
    expect(valuesCall.maxEntries).toBe(1000);
  });
});
