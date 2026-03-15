vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/db/client');
vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn().mockReturnValue(null),
}));
vi.mock('@/lib/db/schema', () => ({
  publishedGames: {
    id: 'id', title: 'title', description: 'description', slug: 'slug',
    userId: 'userId', playCount: 'playCount', status: 'status',
    projectId: 'projectId', version: 'version',
  },
  projects: { id: 'id', sceneData: 'sceneData' },
  users: { id: 'id', clerkId: 'clerkId', displayName: 'displayName' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
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
