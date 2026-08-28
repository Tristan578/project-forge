vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  publishedGames: { id: 'id', userId: 'userId', status: 'status', updatedAt: 'updatedAt' },
}));

describe('DELETE /api/publish/[id]', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as never },
    });
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { DELETE } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/publish/pub-1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'pub-1' }) });

    expect(res.status).toBe(401);
  });

  it('should unpublish game and return success', async () => {
    const mockDb = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { DELETE } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/publish/pub-1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'pub-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should scope the update to the authenticated user', async () => {
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const mockDb = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: whereMock,
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { DELETE } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/publish/pub-1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'pub-1' }) });

    // The soft-delete route does not inspect affected-row count, so its security
    // boundary is the authenticated user id embedded in the update predicate.
    expect(res.status).toBe(200);
    expect(whereMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(whereMock.mock.calls[0][0])).toContain('user_1');
  });

  it('should combine the target id and authenticated user id in the update predicate', async () => {
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const mockDb = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: whereMock,
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { DELETE } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/publish/pub-1', { method: 'DELETE' });
    await DELETE(req, { params: Promise.resolve({ id: 'pub-1' }) });

    const serializedPredicate = JSON.stringify(whereMock.mock.calls[0][0]);
    expect(serializedPredicate).toContain('pub-1');
    expect(serializedPredicate).toContain('user_1');
  });
});
