vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateClerkSession } from '@/lib/auth/api-auth';
import { getUserByClerkId } from '@/lib/auth/user-service';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/auth/user-service');
vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  publishedGames: { id: 'id', userId: 'userId', slug: 'slug' },
}));

describe('GET /api/publish/check-slug', () => {
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
    const req = new NextRequest('http://localhost:3000/api/publish/check-slug?slug=test');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('should return available true when user not found', async () => {
    vi.mocked(getUserByClerkId).mockResolvedValue(null as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/publish/check-slug?slug=test');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.available).toBe(true);
  });

  it('should return 400 when slug param missing', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/publish/check-slug');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('slug is required');
  });

  it('should return available true when slug not taken', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/publish/check-slug?slug=new-game');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.available).toBe(true);
  });

  it('should return available false when slug already exists', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'existing' }]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/publish/check-slug?slug=taken-slug');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.available).toBe(false);
  });
});
