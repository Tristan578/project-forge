vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');

function makeAdminAuth() {
  const user = makeUser();
  vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
  vi.mocked(assertAdmin).mockReturnValue(null);
}

describe('POST /api/admin/moderation/bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const req = new NextRequest('http://localhost/api/admin/moderation/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', commentIds: ['c1'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 if not admin', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(assertAdmin).mockReturnValue(mockNextResponse({ error: 'Forbidden' }, { status: 403 }));

    const req = new NextRequest('http://localhost/api/admin/moderation/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', commentIds: ['c1'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid action', async () => {
    makeAdminAuth();

    const req = new NextRequest('http://localhost/api/admin/moderation/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'ignore', commentIds: ['c1'] }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/approve.*delete|delete.*approve/i);
  });

  it('returns 400 for empty commentIds', async () => {
    makeAdminAuth();

    const req = new NextRequest('http://localhost/api/admin/moderation/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', commentIds: [] }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('non-empty');
  });

  it('returns 400 if commentIds is not an array', async () => {
    makeAdminAuth();

    const req = new NextRequest('http://localhost/api/admin/moderation/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', commentIds: 'c1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 if commentIds contains non-string values', async () => {
    makeAdminAuth();

    const req = new NextRequest('http://localhost/api/admin/moderation/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', commentIds: [1, 2] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('bulk approves comments by clearing flagged status', async () => {
    makeAdminAuth();

    const mockUpdateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getDb).mockReturnValue({
      update: vi.fn().mockReturnValue(mockUpdateChain),
    } as unknown as ReturnType<typeof getDb>);

    const req = new NextRequest('http://localhost/api/admin/moderation/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', commentIds: ['c1', 'c2', 'c3'] }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.processed).toBe(3);
    expect(data.errors).toHaveLength(0);
    expect(mockUpdateChain.set).toHaveBeenCalledWith({ flagged: 0 });
  });

  it('bulk deletes comments', async () => {
    makeAdminAuth();

    const mockDeleteChain = {
      where: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getDb).mockReturnValue({
      delete: vi.fn().mockReturnValue(mockDeleteChain),
    } as unknown as ReturnType<typeof getDb>);

    const req = new NextRequest('http://localhost/api/admin/moderation/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', commentIds: ['c1', 'c2'] }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.processed).toBe(2);
    expect(data.errors).toHaveLength(0);
    expect(mockDeleteChain.where).toHaveBeenCalled();
  });

  it('reports errors when the DB operation fails', async () => {
    makeAdminAuth();

    vi.mocked(getDb).mockReturnValue({
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockRejectedValue(new Error('DB unavailable')),
      }),
    } as unknown as ReturnType<typeof getDb>);

    const req = new NextRequest('http://localhost/api/admin/moderation/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', commentIds: ['c1'] }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.processed).toBe(0);
    expect(data.errors.length).toBeGreaterThan(0);
    expect(data.errors[0]).toContain('DB unavailable');
  });
});
