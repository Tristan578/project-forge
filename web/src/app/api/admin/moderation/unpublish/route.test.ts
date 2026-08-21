vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');

describe('/api/admin/moderation/unpublish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const req = new NextRequest('http://localhost/api/admin/moderation/unpublish', {
      method: 'POST',
      body: JSON.stringify({ gameId: 'game_1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 if not admin', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true,
      ctx: { clerkId: '123', user: makeUser() },
    });
    vi.mocked(assertAdmin).mockReturnValue(mockNextResponse({ error: 'Forbidden' }, { status: 403 }));

    const req = new NextRequest('http://localhost/api/admin/moderation/unpublish', {
      method: 'POST',
      body: JSON.stringify({ gameId: 'game_1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('returns 404 if game does not exist', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true,
      ctx: { clerkId: 'admin_123', user: makeUser() },
    });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
    } as unknown as ReturnType<typeof getDb>);

    const req = new NextRequest('http://localhost/api/admin/moderation/unpublish', {
      method: 'POST',
      body: JSON.stringify({ gameId: 'nonexistent' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('unpublishes the game and returns 200', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true,
      ctx: { clerkId: 'admin_123', user: makeUser() },
    });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const mockGame = { id: 'game_1', title: 'Infringing Game', status: 'published' };
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockGame]),
    };
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(true),
    };
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as unknown as ReturnType<typeof getDb>);

    const req = new NextRequest('http://localhost/api/admin/moderation/unpublish', {
      method: 'POST',
      body: JSON.stringify({ gameId: 'game_1', reason: 'DMCA takedown - Sega IP' }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.previousStatus).toBe('published');
    expect(data.newStatus).toBe('unpublished');
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'unpublished' })
    );
  });

  it('returns 422 for missing gameId', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true,
      ctx: { clerkId: 'admin_123', user: makeUser() },
    });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const req = new NextRequest('http://localhost/api/admin/moderation/unpublish', {
      method: 'POST',
      body: JSON.stringify({ reason: 'no id' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });
});
