vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
}));
vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  publishedGames: { id: 'id', projectId: 'projectId' },
  projects: { id: 'id', userId: 'userId' },
  gameForks: { originalGameId: 'originalGameId', forkedProjectId: 'forkedProjectId', userId: 'userId' },
  users: { id: 'id', tier: 'tier' },
}));

function mockDbChain(data: unknown[] = []) {
  const resolver = vi.fn().mockResolvedValue(data);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  for (const m of ['from', 'leftJoin', 'innerJoin', 'where', 'groupBy', 'orderBy', 'limit', 'offset']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => resolver().then(resolve, reject);
  return chain;
}

describe('POST /api/community/games/[id]/fork', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator', displayName: 'Test' } as never },
    });
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 });
    // Default empty database response; successful paths provide their own rows.
    const mockDb = { select: vi.fn().mockReturnValue(mockDbChain([])), insert: vi.fn() };
    vi.mocked(getDb).mockReturnValue(mockDb as never);
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/fork');
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });

    expect(res.status).toBe(401);
  });

  it('should return 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/fork');
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });

    expect(res.status).toBe(429);
  });

  it('should return 404 when game not found', async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue(mockDbChain([])),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/fork');
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Game not found');
  });

  it('should fork a game and return 201 with new project id', async () => {
    // Game query - destructured [game] from the array
    const gameChain = mockDbChain([{ id: 'game-1', projectId: 'proj-1', userId: 'creator-1', status: 'published', title: 'Test Game' }]);
    // Original project query
    const projectChain = mockDbChain([{ id: 'proj-1', sceneData: {}, entityCount: 5, formatVersion: 1 }]);
    // User tier query
    const userChain = mockDbChain([{ tier: 'creator' }]);
    // User projects count (resolves at .where(), no .limit())
    const userProjectsChain = mockDbChain([{ id: 'p1' }]);

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(projectChain)
        .mockReturnValueOnce(userChain)
        .mockReturnValueOnce(userProjectsChain),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 'new-proj-1' }]),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/fork');
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.projectId).toBe('new-proj-1');
  });

  it('should return 403 when project limit reached', async () => {
    const gameChain = mockDbChain([{ id: 'game-1', projectId: 'proj-1', title: 'Test', status: 'published', publishedSceneData: null, userId: 'creator-1' }]);
    const projectChain = mockDbChain([{ id: 'proj-1', sceneData: {}, entityCount: 5, formatVersion: 1 }]);
    const userChain = mockDbChain([{ tier: 'starter' }]);
    // Simulate 3 existing projects (starter limit is 3)
    const userProjectsChain = mockDbChain([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(projectChain)
        .mockReturnValueOnce(userChain)
        .mockReturnValueOnce(userProjectsChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/fork');
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('Project limit reached for your tier');
  });
  async function requestFork() {
    const { POST } = await import('./route');
    return POST(new NextRequest('http://localhost:3000/api/community/games/game-1/fork'), {
      params: Promise.resolve({ id: 'game-1' }),
    });
  }

  it.each(['unpublished', 'flagged', 'processing'])('rejects %s games before fetching their project or creating a fork', async (status) => {
    const select = vi.fn().mockReturnValue(mockDbChain([{
      id: 'game-1', projectId: 'proj-1', status,
      publishedSceneData: { entities: [] },
    }]));
    const insert = vi.fn();
    vi.mocked(getDb).mockReturnValue({ select, insert } as never);
    const response = await requestFork();
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('Game not found');
    expect(select).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
  });

  it('copies the published snapshot without fetching the live project and disables scripts before persistence', async () => {
    const source = {
      formatVersion: 2,
      entities: [
        { id: 'published', scriptData: { source: 'forge.log("published");', enabled: true } },
        { id: 'second', scriptData: { source: 'forge.log("disabled");', enabled: false } },
      ],
    };
    const before = structuredClone(source);
    const gameChain = mockDbChain([{
      id: 'game-1', projectId: 'private-draft', title: 'Published Game',
      status: 'published', publishedSceneData: source,
    }]);
    const userChain = mockDbChain([{ tier: 'creator' }]);
    const countChain = mockDbChain([]);
    const select = vi.fn()
      .mockReturnValueOnce(gameChain)
      .mockReturnValueOnce(userChain)
      .mockReturnValueOnce(countChain);
    const values = vi.fn().mockReturnThis();
    const insert = vi.fn().mockReturnValue({
      values, returning: vi.fn().mockResolvedValue([{ id: 'fork-project' }]),
    });
    vi.mocked(getDb).mockReturnValue({ select, insert } as never);

    const response = await requestFork();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ projectId: 'fork-project', quarantinedScripts: 1 });
    // Exactly game, user-tier, and user's project-count queries: no source project read.
    expect(select).toHaveBeenCalledTimes(3);
    expect(gameChain.from).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'projectId' }));
    expect(userChain.from).toHaveBeenCalledWith(expect.objectContaining({ tier: 'tier' }));
    expect(countChain.from).toHaveBeenCalledWith(expect.objectContaining({ userId: 'userId' }));
    expect(values.mock.calls[0][0]).toEqual({
      userId: 'user_1', name: 'Published Game (Fork)', entityCount: 2, formatVersion: 2,
      sceneData: {
        ...source,
        entities: source.entities.map((entity) => ({
          ...entity, scriptData: { ...entity.scriptData, enabled: false },
        })),
      },
    });
    expect(values.mock.calls[1][0]).toEqual({
      originalGameId: 'game-1', forkedProjectId: 'fork-project', userId: 'user_1',
    });
    expect(source).toEqual(before);
  });

  it.each([[], 'invalid', 42, false])('rejects an invalid snapshot %# without falling back to the live project', async (publishedSceneData) => {
    const select = vi.fn().mockReturnValue(mockDbChain([{
      id: 'game-1', projectId: 'private-draft', status: 'published', publishedSceneData,
    }]));
    const insert = vi.fn();
    vi.mocked(getDb).mockReturnValue({ select, insert } as never);
    const response = await requestFork();
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('Failed to fork game');
    expect(select).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
  });

  it('quarantines scripts in the legacy fallback and preserves its project metadata', async () => {
    const source = { entities: [{ scriptData: { source: 'legacy-source', enabled: true } }] };
    const select = vi.fn()
      .mockReturnValueOnce(mockDbChain([{
        id: 'game-1', projectId: 'proj-1', userId: 'creator-1', title: 'Legacy',
        status: 'published', publishedSceneData: null,
      }]))
      .mockReturnValueOnce(mockDbChain([{ sceneData: source, entityCount: 9, formatVersion: 3 }]))
      .mockReturnValueOnce(mockDbChain([{ tier: 'creator' }]))
      .mockReturnValueOnce(mockDbChain([]));
    const values = vi.fn().mockReturnThis();
    const insert = vi.fn().mockReturnValue({
      values, returning: vi.fn().mockResolvedValue([{ id: 'fork-project' }]),
    });
    vi.mocked(getDb).mockReturnValue({ select, insert } as never);
    const response = await requestFork();
    expect(response.status).toBe(201);
    expect(select).toHaveBeenCalledTimes(4);
    expect(values.mock.calls[0][0]).toMatchObject({
      entityCount: 9, formatVersion: 3,
      sceneData: { entities: [{ scriptData: { source: 'legacy-source', enabled: false } }] },
    });
    expect(source.entities[0].scriptData.enabled).toBe(true);
  });

});
