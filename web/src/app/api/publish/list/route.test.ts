vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticateClerkSession } from '@/lib/auth/api-auth';
import { getUserByClerkId } from '@/lib/auth/user-service';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/auth/user-service');
vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  publishedGames: {
    id: 'id',
    userId: 'userId',
    projectId: 'projectId',
    slug: 'slug',
    title: 'title',
    description: 'description',
    status: 'status',
    version: 'version',
    cdnUrl: 'cdnUrl',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
}));

describe('GET /api/publish/list', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(authenticateClerkSession).mockResolvedValue({
      ok: true as const,
      clerkId: 'clerk_1',
    });
    vi.mocked(getUserByClerkId).mockResolvedValue({ id: 'user_1' } as never);
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateClerkSession).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(401);
  });

  it('should return empty publications when user not found', async () => {
    vi.mocked(getUserByClerkId).mockResolvedValue(null as never);

    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.publications).toEqual([]);
  });

  it('should return publications list with URLs', async () => {
    const pubsData = [{
      id: 'pub-1',
      projectId: 'project-1',
      title: 'My Game',
      slug: 'my-game',
      description: null,
      status: 'published',
      version: 1,
      url: null,
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
      userId: 'internal-user-id',
      futureInternalColumn: 'must-not-leak',
    }];
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(pubsData),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.publications).toHaveLength(1);
    expect(body.publications[0].url).toBe('/play/clerk_1/my-game');
    expect(Object.keys(body.publications[0]).sort()).toEqual([
      'createdAt',
      'description',
      'id',
      'projectId',
      'slug',
      'status',
      'title',
      'updatedAt',
      'url',
      'version',
    ]);
    expect(mockDb.select).toHaveBeenCalledWith({
      id: 'id',
      projectId: 'projectId',
      slug: 'slug',
      title: 'title',
      description: 'description',
      status: 'status',
      version: 'version',
      url: 'cdnUrl',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    });
  });

  it('should use cdnUrl when available', async () => {
    const pubsData = [{
      id: 'pub-1',
      projectId: 'project-1',
      slug: 'my-game',
      title: 'My Game',
      description: null,
      status: 'published',
      version: 1,
      url: 'https://cdn.example.com/games/my-game',
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
    }];
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(pubsData),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.publications[0].url).toBe('https://cdn.example.com/games/my-game');
  });
});
