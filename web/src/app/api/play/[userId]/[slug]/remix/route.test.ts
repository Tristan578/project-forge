/**
 * Tests for POST /api/play/[userId]/[slug]/remix
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock dependencies
vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  })),
  queryWithResilience: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/db/schema', () => ({
  publishedGames: { id: 'id', title: 'title', slug: 'slug', userId: 'user_id', projectId: 'project_id' },
  projects: { id: 'id', userId: 'user_id', sceneData: 'scene_data', name: 'name' },
  users: { id: 'id', clerkId: 'clerk_id' },
  gameForks: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
}));

vi.mock('@/lib/auth/safe-auth', () => ({
  safeAuth: vi.fn().mockResolvedValue({ userId: null }),
}));

vi.mock('@/lib/projects/service', () => ({
  createProject: vi.fn().mockResolvedValue({ id: 'new-project-id', name: 'Remixed Game' }),
}));

vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

describe('POST /api/play/[userId]/[slug]/remix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/user-1/my-game/remix', {
      method: 'POST',
    });

    const res = await POST(req, {
      params: Promise.resolve({ userId: 'user-1', slug: 'my-game' }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Sign in');
  });

  it('returns 404 when game is not found', async () => {
    const { safeAuth } = await import('@/lib/auth/safe-auth');
    vi.mocked(safeAuth).mockResolvedValue({ userId: 'clerk-remixer' });

    const { getDb } = await import('@/lib/db/client');
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    // User lookup returns a user
    mockDb.limit.mockResolvedValueOnce([{ id: 'remixer-uuid' }]);
    // Creator user lookup
    mockDb.limit.mockResolvedValueOnce([{ id: 'creator-uuid' }]);
    // Game lookup returns empty
    mockDb.limit.mockResolvedValueOnce([]);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/user-1/my-game/remix', {
      method: 'POST',
    });

    const res = await POST(req, {
      params: Promise.resolve({ userId: 'user-1', slug: 'my-game' }),
    });

    expect(res.status).toBe(404);
  });

  it('creates a forked project on success', async () => {
    const { safeAuth } = await import('@/lib/auth/safe-auth');
    vi.mocked(safeAuth).mockResolvedValue({ userId: 'clerk-remixer' });

    const { createProject } = await import('@/lib/projects/service');
    vi.mocked(createProject).mockResolvedValue({
      id: 'forked-project-id',
      name: 'My Game (Remix)',
      userId: 'remixer-uuid',
      sceneData: {},
      entityCount: 0,
      formatVersion: 1,
      thumbnail: null,
      theme: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { getDb } = await import('@/lib/db/client');
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'fork-record-id' }]),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    // Remixer user lookup
    mockDb.limit.mockResolvedValueOnce([{ id: 'remixer-uuid' }]);
    // Creator user lookup
    mockDb.limit.mockResolvedValueOnce([{ id: 'creator-uuid' }]);
    // Game lookup
    mockDb.limit.mockResolvedValueOnce([{
      id: 'game-uuid',
      title: 'My Game',
      projectId: 'orig-project-id',
    }]);
    // Project data lookup
    mockDb.limit.mockResolvedValueOnce([{ sceneData: { entities: [] } }]);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/play/user-1/my-game/remix', {
      method: 'POST',
    });

    const res = await POST(req, {
      params: Promise.resolve({ userId: 'user-1', slug: 'my-game' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.projectId).toBe('forked-project-id');
    expect(createProject).toHaveBeenCalledWith(
      'remixer-uuid',
      'My Game (Remix)',
      { entities: [] }
    );
  });
});
