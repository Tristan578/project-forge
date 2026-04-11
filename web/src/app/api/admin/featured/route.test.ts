vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  featuredGames: { id: 'id', gameId: 'gameId', position: 'position', featuredAt: 'featuredAt', expiresAt: 'expiresAt' },
  publishedGames: { id: 'id', title: 'title', slug: 'slug', userId: 'userId' },
  users: { id: 'id', displayName: 'displayName' },
}));

describe('GET /api/admin/featured', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'admin_clerk', user: { id: 'admin_1', tier: 'pro' } as never },
    });
    vi.mocked(assertAdmin).mockReturnValue(null);
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/api/admin/featured'));

    expect(res.status).toBe(401);
  });

  it('should return 403 when not admin', async () => {
    const adminResponse = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    vi.mocked(assertAdmin).mockReturnValue(adminResponse as never);

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/api/admin/featured'));

    expect(res.status).toBe(403);
  });

  it('should return featured games list', async () => {
    const featuredData = [{
      id: 'f1',
      gameId: 'g1',
      position: 1,
      featuredAt: new Date('2025-01-01'),
      expiresAt: null,
      gameTitle: 'Featured Game',
      gameSlug: 'featured-game',
      authorName: 'Author',
    }];
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(featuredData),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/api/admin/featured'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.featured).toHaveLength(1);
    expect(body.featured[0].gameTitle).toBe('Featured Game');
  });
});

describe('POST /api/admin/featured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'admin_clerk', user: { id: 'admin_1', tier: 'pro' } as never },
    });
    vi.mocked(assertAdmin).mockReturnValue(null);
  });

  it('should return 400 when gameId is missing', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/admin/featured', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Validation failed');
    expect(JSON.stringify(body.issues)).toContain('gameId');
  });

  it('should return 404 when game not found', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/admin/featured', {
      method: 'POST',
      body: JSON.stringify({ gameId: 'nonexistent' }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Game not found');
  });

  it('should feature a game and return 201', async () => {
    // Game exists check
    const gameChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'g1' }]),
    };
    // Count check (< 5)
    const countChain = {
      from: vi.fn().mockResolvedValue([{ count: 2 }]),
    };
    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(countChain),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 'f-new', gameId: 'g1', position: 0 }]),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/admin/featured', {
      method: 'POST',
      body: JSON.stringify({ gameId: 'g1', position: 1 }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.featured).toBeDefined();
  });

  it('should return 409 when max featured limit reached', async () => {
    const gameChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'g1' }]),
    };
    const countChain = {
      from: vi.fn().mockResolvedValue([{ count: 5 }]),
    };
    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(gameChain)
        .mockReturnValueOnce(countChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/admin/featured', {
      method: 'POST',
      body: JSON.stringify({ gameId: 'g1' }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('Maximum 5');
  });
});

describe('DELETE /api/admin/featured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'admin_clerk', user: { id: 'admin_1', tier: 'pro' } as never },
    });
    vi.mocked(assertAdmin).mockReturnValue(null);
  });

  it('should return 400 when id query param missing', async () => {
    const { DELETE } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/admin/featured', { method: 'DELETE' });
    const res = await DELETE(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('id query param required');
  });

  it('should remove featured entry', async () => {
    const mockDb = {
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { DELETE } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/admin/featured?id=f1', { method: 'DELETE' });
    const res = await DELETE(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.removed).toBe(true);
  });
});
