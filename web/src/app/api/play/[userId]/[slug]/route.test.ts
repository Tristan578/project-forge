vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/db/client');
vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/db/schema', () => ({
  publishedGames: {
    id: 'id', title: 'title', description: 'description', slug: 'slug',
    userId: 'userId', playCount: 'playCount', status: 'status',
    projectId: 'projectId', version: 'version', cdnBundleKey: 'cdnBundleKey',
  },
  projects: { id: 'id', sceneData: 'sceneData' },
  users: { id: 'id', clerkId: 'clerkId', displayName: 'displayName' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
}));

// R2 read path (#7580). Default OFF so the existing Postgres-path tests below
// stay on their original code path; the R2 describe flips it on per test.
const isPublishToR2EnabledMock = vi.hoisted(() => vi.fn(() => false));
const readBundleMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/config/assetStorage', () => ({
  isPublishToR2Enabled: () => isPublishToR2EnabledMock(),
}));
vi.mock('@/lib/storage/publishedGameStorage', () => ({
  readPublishedGameBundle: (...args: unknown[]) => readBundleMock(...args),
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: captureExceptionMock,
}));

/**
 * Creates a mock DB chain that resolves to `data` for select queries
 * and provides update/set/where chain for fire-and-forget updates.
 */
function mockDbChain(data: unknown[] = []) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  const methods = ['from', 'where', 'limit', 'select'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Make the chain thenable
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(data).then(resolve, reject);
  return chain;
}

function mockUpdateChain() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  const methods = ['set', 'where'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve([]).then(resolve, reject);
  return chain;
}

describe('GET /api/play/[userId]/[slug]', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns 404 when user is not found', async () => {
    const userChain = mockDbChain([]);

    const mockDb = {
      select: vi.fn().mockReturnValue(userChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/play/clerk_unknown/my-game');
    const res = await GET(req, { params: Promise.resolve({ userId: 'clerk_unknown', slug: 'my-game' }) });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toBe('Game not found');
  });

  it('returns 404 when game is not found', async () => {
    const userChain = mockDbChain([{ id: 'db-user-1', displayName: 'TestUser' }]);
    const gameChain = mockDbChain([]);

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(userChain)
        .mockReturnValueOnce(gameChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/play/clerk_1/nonexistent');
    const res = await GET(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'nonexistent' }) });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toBe('Game not found');
  });

  it('returns 404 when game is not published', async () => {
    const userChain = mockDbChain([{ id: 'db-user-1', displayName: 'TestUser' }]);
    const gameChain = mockDbChain([{
      id: 'game-1', title: 'Draft Game', description: 'WIP',
      slug: 'draft-game', userId: 'db-user-1', status: 'draft',
      projectId: 'proj-1', version: 1,
    }]);

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(userChain)
        .mockReturnValueOnce(gameChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/play/clerk_1/draft-game');
    const res = await GET(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'draft-game' }) });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toBe('This game is not currently published');
  });

  it('returns 404 when project scene data is missing', async () => {
    const userChain = mockDbChain([{ id: 'db-user-1', displayName: 'TestUser' }]);
    const gameChain = mockDbChain([{
      id: 'game-1', title: 'Test Game', description: 'Fun game',
      slug: 'test-game', userId: 'db-user-1', status: 'published',
      projectId: 'proj-missing', version: 1,
    }]);
    const projectChain = mockDbChain([]);

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(userChain)
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(projectChain),
      update: vi.fn().mockReturnValue(mockUpdateChain()),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/play/clerk_1/test-game');
    const res = await GET(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'test-game' }) });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toBe('Game data not found');
  });

  it('returns game data with scene data on success', async () => {
    const sceneData = { entities: [], metadata: {} };
    const userChain = mockDbChain([{ id: 'db-user-1', displayName: 'GameMaker' }]);
    const gameChain = mockDbChain([{
      id: 'game-1', title: 'Awesome Game', description: 'Play it!',
      slug: 'awesome-game', userId: 'db-user-1', status: 'published',
      projectId: 'proj-1', version: 3,
    }]);
    const projectChain = mockDbChain([{ sceneData }]);

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(userChain)
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(projectChain),
      update: vi.fn().mockReturnValue(mockUpdateChain()),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/play/clerk_1/awesome-game');
    const res = await GET(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'awesome-game' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.game.id).toBe('game-1');
    expect(data.game.title).toBe('Awesome Game');
    expect(data.game.slug).toBe('awesome-game');
    expect(data.game.version).toBe(3);
    expect(data.game.creatorName).toBe('GameMaker');
    expect(data.game.sceneData).toEqual(sceneData);
  });

  it('serves scene data from the R2 bundle and does NOT query projects when the read succeeds', async () => {
    isPublishToR2EnabledMock.mockReturnValue(true);
    const bundleScene = { entities: [{ id: 'from-r2' }], metadata: { source: 'r2' } };
    readBundleMock.mockResolvedValue({
      sceneData: bundleScene,
      manifest: { version: 2, publishedAt: 'x', slug: 'cdn-game', userId: 'clerk_1' },
    });

    const userChain = mockDbChain([{ id: 'db-user-1', displayName: 'GameMaker' }]);
    const gameChain = mockDbChain([{
      id: 'game-1', title: 'CDN Game', description: 'Fast!',
      slug: 'cdn-game', userId: 'db-user-1', status: 'published',
      projectId: 'proj-1', version: 2, cdnBundleKey: 'games/clerk_1/cdn-game/v2/bundle.json',
    }]);
    // No project chain: if the route queried projects this would be undefined
    // and the test would surface it.
    const select = vi.fn().mockReturnValueOnce(userChain).mockReturnValueOnce(gameChain);
    const mockDb = { select, update: vi.fn().mockReturnValue(mockUpdateChain()) };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/play/clerk_1/cdn-game');
    const res = await GET(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'cdn-game' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.game.sceneData).toEqual(bundleScene);
    // The read is keyed by the DB row's OWN version, so the route passes
    // game.version through — that is what pins the read to the object matching
    // the version the database claims (#7580 review round 2).
    expect(readBundleMock).toHaveBeenCalledWith('clerk_1', 'cdn-game', 2);
    // Two selects only (user + game). A third would mean it fell back to the
    // projects.sceneData query despite a successful R2 read.
    expect(select).toHaveBeenCalledTimes(2);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('falls back to Postgres when the bundle is stale (manifest/version mismatch)', async () => {
    // readPublishedGameBundle throws on a version/slug/userId mismatch (its unit
    // tests pin that). At the route level that throw must be treated exactly
    // like a missing object: log to Sentry and serve the Postgres scene data,
    // never the stale bundle (#7580 review round 2, item 2).
    isPublishToR2EnabledMock.mockReturnValue(true);
    readBundleMock.mockRejectedValue(
      new Error('bundle does not match the requested publication — treating as stale'),
    );

    const dbScene = { entities: [{ id: 'from-postgres-not-stale' }] };
    const userChain = mockDbChain([{ id: 'db-user-1', displayName: 'GameMaker' }]);
    const gameChain = mockDbChain([{
      id: 'game-1', title: 'CDN Game', description: 'Fresh',
      slug: 'cdn-game', userId: 'db-user-1', status: 'published',
      projectId: 'proj-1', version: 5, cdnBundleKey: 'games/clerk_1/cdn-game/v5/bundle.json',
    }]);
    const projectChain = mockDbChain([{ sceneData: dbScene }]);
    const select = vi.fn()
      .mockReturnValueOnce(userChain)
      .mockReturnValueOnce(gameChain)
      .mockReturnValueOnce(projectChain);
    const mockDb = { select, update: vi.fn().mockReturnValue(mockUpdateChain()) };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/play/clerk_1/cdn-game');
    const res = await GET(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'cdn-game' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.game.sceneData).toEqual(dbScene);
    // The stale bundle is rejected, the projects fallback query runs, and the
    // mismatch is surfaced to Sentry under the same stage as any other R2 read
    // failure.
    expect(readBundleMock).toHaveBeenCalledWith('clerk_1', 'cdn-game', 5);
    expect(select).toHaveBeenCalledTimes(3);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const ctx = captureExceptionMock.mock.calls[0][1] as { stage?: string };
    expect(ctx.stage).toBe('r2-bundle-read');
  });

  it('falls back to Postgres sceneData and logs to Sentry when the R2 read fails', async () => {
    isPublishToR2EnabledMock.mockReturnValue(true);
    readBundleMock.mockRejectedValue(new Error('NoSuchKey'));

    const dbScene = { entities: [{ id: 'from-postgres' }] };
    const userChain = mockDbChain([{ id: 'db-user-1', displayName: 'GameMaker' }]);
    const gameChain = mockDbChain([{
      id: 'game-1', title: 'CDN Game', description: 'Fallback',
      slug: 'cdn-game', userId: 'db-user-1', status: 'published',
      projectId: 'proj-1', version: 2, cdnBundleKey: 'games/clerk_1/cdn-game/v2/bundle.json',
    }]);
    const projectChain = mockDbChain([{ sceneData: dbScene }]);
    const select = vi.fn()
      .mockReturnValueOnce(userChain)
      .mockReturnValueOnce(gameChain)
      .mockReturnValueOnce(projectChain);
    const mockDb = { select, update: vi.fn().mockReturnValue(mockUpdateChain()) };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/play/clerk_1/cdn-game');
    const res = await GET(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'cdn-game' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.game.sceneData).toEqual(dbScene);
    expect(readBundleMock).toHaveBeenCalledTimes(1);
    // Three selects: user + game + the projects fallback query.
    expect(select).toHaveBeenCalledTimes(3);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const ctx = captureExceptionMock.mock.calls[0][1] as { stage?: string; slug?: string };
    expect(ctx.stage).toBe('r2-bundle-read');
    expect(ctx.slug).toBe('cdn-game');
  });

  it('stays on the Postgres path when the row has no bundle key even if R2 is enabled', async () => {
    isPublishToR2EnabledMock.mockReturnValue(true);
    const dbScene = { entities: [] };
    const userChain = mockDbChain([{ id: 'db-user-1', displayName: 'GameMaker' }]);
    const gameChain = mockDbChain([{
      id: 'game-1', title: 'Legacy Game', description: 'No bundle',
      slug: 'legacy', userId: 'db-user-1', status: 'published',
      projectId: 'proj-1', version: 1, cdnBundleKey: null,
    }]);
    const projectChain = mockDbChain([{ sceneData: dbScene }]);
    const select = vi.fn()
      .mockReturnValueOnce(userChain)
      .mockReturnValueOnce(gameChain)
      .mockReturnValueOnce(projectChain);
    const mockDb = { select, update: vi.fn().mockReturnValue(mockUpdateChain()) };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/play/clerk_1/legacy');
    const res = await GET(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'legacy' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.game.sceneData).toEqual(dbScene);
    expect(readBundleMock).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledTimes(3);
  });

  it('returns 500 when an unexpected error occurs', async () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error('DB connection failed');
    });

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/play/clerk_1/test');
    const res = await GET(req, { params: Promise.resolve({ userId: 'clerk_1', slug: 'test' }) });
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('Failed to load game');
  });
});
