/**
 * Tests for per-game dynamic OG image generation.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB client
vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  })),
  queryWithResilience: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/db/schema', () => ({
  publishedGames: { title: 'title', description: 'description', userId: 'user_id', slug: 'slug' },
  users: { id: 'id', clerkId: 'clerk_id', displayName: 'display_name' },
}));

describe('Per-Game OG Image', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('exports correct size (1200x630)', async () => {
    const mod = await import('../opengraph-image');
    expect(mod.size).toEqual({ width: 1200, height: 630 });
  });

  it('exports image/png content type', async () => {
    const mod = await import('../opengraph-image');
    expect(mod.contentType).toBe('image/png');
  });

  it('exports alt text', async () => {
    const mod = await import('../opengraph-image');
    expect(mod.alt).toBe('SpawnForge Game');
  });

  it('returns an ImageResponse for a valid game', async () => {
    const { getDb } = await import('@/lib/db/client');
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(),
    };
    // First call: user lookup
    mockDb.limit.mockResolvedValueOnce([{ id: 'user-uuid', displayName: 'Alice' }]);
    // Second call: game lookup
    mockDb.limit.mockResolvedValueOnce([{
      title: 'My Platformer',
      description: 'A fun game',
    }]);
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const mod = await import('../opengraph-image');
    const response = await mod.default({
      params: Promise.resolve({ userId: 'clerk-123', slug: 'my-platformer' }),
    });

    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get('content-type')).toContain('image/png');
  });

  it('returns a fallback image when game not found', async () => {
    const { getDb } = await import('@/lib/db/client');
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(),
    };
    // User found, game not found
    mockDb.limit.mockResolvedValueOnce([{ id: 'user-uuid', displayName: 'Alice' }]);
    mockDb.limit.mockResolvedValueOnce([]);
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const mod = await import('../opengraph-image');
    const response = await mod.default({
      params: Promise.resolve({ userId: 'clerk-123', slug: 'nonexistent' }),
    });

    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get('content-type')).toContain('image/png');
  });
});
