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
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator', displayName: 'Test' } as never },
    });
    vi.mocked(rateLimit).mockReturnValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 });
    // getDb() is called at the top of the try block before auth/rate-limit checks
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
    vi.mocked(rateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

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
    const gameChain = mockDbChain([{ id: 'game-1', projectId: 'proj-1', title: 'Test Game' }]);
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
    const gameChain = mockDbChain([{ id: 'game-1', projectId: 'proj-1', title: 'Test' }]);
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
});
