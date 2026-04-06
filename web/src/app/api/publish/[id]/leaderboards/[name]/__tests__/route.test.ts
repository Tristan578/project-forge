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
    maxEntries: 'maxEntries', minScore: 'minScore', maxScore: 'maxScore',
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
function makeUpdateChain(): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  chain.set = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(undefined).then(resolve);
  return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDeleteChain(): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  chain.where = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(undefined).then(resolve);
  return chain;
}

function makeParams(id: string, name: string) {
  return { params: Promise.resolve({ id, name }) };
}

function jsonRequest(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  });
}

const GAME = { id: 'game-1' };
const BOARD = { id: 'board-1', name: 'highscore', sortOrder: 'desc', maxEntries: 100, minScore: null, maxScore: null };

// ---------------------------------------------------------------------------
// PATCH /api/publish/[id]/leaderboards/[name]
// ---------------------------------------------------------------------------

describe('PATCH /api/publish/[id]/leaderboards/[name]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockWithApiMiddleware.mockResolvedValue({ userId: 'user-1' });
  });

  it('returns 404 when game not owned', async () => {
    const gameChain = makeSelectChain([]);
    mockGetDb.mockReturnValue({ select: vi.fn().mockReturnValue(gameChain) });

    const { PATCH } = await import('../route');
    const res = await PATCH(
      jsonRequest('http://localhost', 'PATCH', { sortOrder: 'asc' }),
      makeParams('game-1', 'highscore'),
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 when board not found', async () => {
    const gameChain = makeSelectChain([GAME]);
    const boardChain = makeSelectChain([]);
    mockGetDb.mockReturnValue({
      select: vi.fn()
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(boardChain),
    });

    const { PATCH } = await import('../route');
    const res = await PATCH(
      jsonRequest('http://localhost', 'PATCH', { sortOrder: 'asc' }),
      makeParams('game-1', 'missing'),
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Leaderboard not found');
  });

  it('returns 400 for invalid JSON body', async () => {
    const gameChain = makeSelectChain([GAME]);
    const boardChain = makeSelectChain([BOARD]);
    mockGetDb.mockReturnValue({
      select: vi.fn()
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(boardChain),
    });

    const { PATCH } = await import('../route');
    const res = await PATCH(
      new NextRequest('http://localhost', {
        method: 'PATCH',
        body: 'not json',
        headers: { 'Content-Type': 'application/json' },
      }),
      makeParams('game-1', 'highscore'),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid JSON body');
  });

  it('returns 400 when no valid fields provided', async () => {
    const gameChain = makeSelectChain([GAME]);
    const boardChain = makeSelectChain([BOARD]);
    mockGetDb.mockReturnValue({
      select: vi.fn()
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(boardChain),
    });

    const { PATCH } = await import('../route');
    const res = await PATCH(
      jsonRequest('http://localhost', 'PATCH', { unrecognized: true }),
      makeParams('game-1', 'highscore'),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('No valid fields to update');
  });

  it('returns 400 when minScore > maxScore', async () => {
    const gameChain = makeSelectChain([GAME]);
    const boardChain = makeSelectChain([BOARD]);
    mockGetDb.mockReturnValue({
      select: vi.fn()
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(boardChain),
    });

    const { PATCH } = await import('../route');
    const res = await PATCH(
      jsonRequest('http://localhost', 'PATCH', { minScore: 500, maxScore: 100 }),
      makeParams('game-1', 'highscore'),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('minScore must be <= maxScore');
  });

  it('returns 400 for malformed percent-encoding in board name', async () => {
    const gameChain = makeSelectChain([GAME]);
    mockGetDb.mockReturnValue({ select: vi.fn().mockReturnValue(gameChain) });

    const { PATCH } = await import('../route');
    const res = await PATCH(
      jsonRequest('http://localhost', 'PATCH', { sortOrder: 'asc' }),
      makeParams('game-1', '%E0%A4%A'),  // malformed percent-encoding
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid leaderboard name');
  });

  it('updates sort order successfully', async () => {
    const gameChain = makeSelectChain([GAME]);
    const boardChain = makeSelectChain([BOARD]);
    const updateChain = makeUpdateChain();
    mockGetDb.mockReturnValue({
      select: vi.fn()
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(boardChain),
      update: vi.fn().mockReturnValue(updateChain),
    });

    const { PATCH } = await import('../route');
    const res = await PATCH(
      jsonRequest('http://localhost', 'PATCH', { sortOrder: 'asc' }),
      makeParams('game-1', 'highscore'),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.updated).toContain('sortOrder');
  });

  it('clamps maxEntries to 1-1000', async () => {
    const gameChain = makeSelectChain([GAME]);
    const boardChain = makeSelectChain([BOARD]);
    const updateChain = makeUpdateChain();
    mockGetDb.mockReturnValue({
      select: vi.fn()
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(boardChain),
      update: vi.fn().mockReturnValue(updateChain),
    });

    const { PATCH } = await import('../route');
    const res = await PATCH(
      jsonRequest('http://localhost', 'PATCH', { maxEntries: -5 }),
      makeParams('game-1', 'highscore'),
    );
    expect(res.status).toBe(200);
    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.maxEntries).toBe(1);
  });

  it('allows setting minScore to null', async () => {
    const gameChain = makeSelectChain([GAME]);
    const boardChain = makeSelectChain([BOARD]);
    const updateChain = makeUpdateChain();
    mockGetDb.mockReturnValue({
      select: vi.fn()
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(boardChain),
      update: vi.fn().mockReturnValue(updateChain),
    });

    const { PATCH } = await import('../route');
    const res = await PATCH(
      jsonRequest('http://localhost', 'PATCH', { minScore: null }),
      makeParams('game-1', 'highscore'),
    );
    expect(res.status).toBe(200);
    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.minScore).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/publish/[id]/leaderboards/[name]
// ---------------------------------------------------------------------------

describe('DELETE /api/publish/[id]/leaderboards/[name]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockWithApiMiddleware.mockResolvedValue({ userId: 'user-1' });
  });

  it('returns 404 when game not owned', async () => {
    const gameChain = makeSelectChain([]);
    mockGetDb.mockReturnValue({ select: vi.fn().mockReturnValue(gameChain) });

    const { DELETE } = await import('../route');
    const res = await DELETE(
      new NextRequest('http://localhost', { method: 'DELETE' }),
      makeParams('game-1', 'highscore'),
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 when board not found', async () => {
    const gameChain = makeSelectChain([GAME]);
    const boardChain = makeSelectChain([]);
    mockGetDb.mockReturnValue({
      select: vi.fn()
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(boardChain),
    });

    const { DELETE } = await import('../route');
    const res = await DELETE(
      new NextRequest('http://localhost', { method: 'DELETE' }),
      makeParams('game-1', 'missing'),
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 for malformed percent-encoding', async () => {
    const gameChain = makeSelectChain([GAME]);
    mockGetDb.mockReturnValue({ select: vi.fn().mockReturnValue(gameChain) });

    const { DELETE } = await import('../route');
    const res = await DELETE(
      new NextRequest('http://localhost', { method: 'DELETE' }),
      makeParams('game-1', '%E0%A4%A'),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid leaderboard name');
  });

  it('deletes board and returns success', async () => {
    const gameChain = makeSelectChain([GAME]);
    const boardChain = makeSelectChain([BOARD]);
    const deleteChain = makeDeleteChain();
    mockGetDb.mockReturnValue({
      select: vi.fn()
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(boardChain),
      delete: vi.fn().mockReturnValue(deleteChain),
    });

    const { DELETE } = await import('../route');
    const res = await DELETE(
      new NextRequest('http://localhost', { method: 'DELETE' }),
      makeParams('game-1', 'highscore'),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it('returns middleware error when not authenticated', async () => {
    mockWithApiMiddleware.mockResolvedValue({ error: new Response('Unauthorized', { status: 401 }) });

    const { DELETE } = await import('../route');
    const res = await DELETE(
      new NextRequest('http://localhost', { method: 'DELETE' }),
      makeParams('game-1', 'highscore'),
    );
    expect(res.status).toBe(401);
  });
});
