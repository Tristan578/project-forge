import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticateClerkSession } from '@/lib/auth/api-auth';
import { getUserByClerkId } from '@/lib/auth/user-service';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/auth/user-service');
vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  publishedGames: { userId: 'userId', updatedAt: 'updatedAt' },
}));

describe('GET /api/publish/list', () => {
  beforeEach(() => {
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
      title: 'My Game',
      slug: 'my-game',
      cdnUrl: null,
      status: 'published',
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
  });

  it('should use cdnUrl when available', async () => {
    const pubsData = [{
      id: 'pub-1',
      slug: 'my-game',
      cdnUrl: 'https://cdn.example.com/games/my-game',
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
