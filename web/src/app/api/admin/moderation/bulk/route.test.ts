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
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });
    const req = new NextRequest('http://localhost/api/admin/moderation/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', commentIds: ['c1'] }),
    });
    expect((await POST(req)).status).toBe(401);
  });

  it('returns 400 for invalid action', async () => {
    makeAdminAuth();
    const req = new NextRequest('http://localhost/api/admin/moderation/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'ignore', commentIds: ['c1'] }),
    });
    expect((await POST(req)).status).toBe(400);
  });

  it('returns 400 for empty commentIds', async () => {
    makeAdminAuth();
    const req = new NextRequest('http://localhost/api/admin/moderation/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', commentIds: [] }),
    });
    expect((await POST(req)).status).toBe(400);
  });

  it('returns actual DB affected count, not ids.length (PF-457)', async () => {
    makeAdminAuth();
    const mockChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]),
    };
    vi.mocked(getDb).mockReturnValue({
      update: vi.fn().mockReturnValue(mockChain),
    } as unknown as ReturnType<typeof getDb>);

    const req = new NextRequest('http://localhost/api/admin/moderation/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', commentIds: ['c1', 'c2', 'c3'] }),
    });
    const data = await (await POST(req)).json();
    expect(data.processed).toBe(2); // NOT 3
    expect(data.errors).toHaveLength(0);
  });

  it('bulk deletes and returns actual affected count', async () => {
    makeAdminAuth();
    vi.mocked(getDb).mockReturnValue({
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 'c1' }]),
      }),
    } as unknown as ReturnType<typeof getDb>);

    const req = new NextRequest('http://localhost/api/admin/moderation/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', commentIds: ['c1', 'c2'] }),
    });
    const data = await (await POST(req)).json();
    expect(data.processed).toBe(1);
  });

  it('reports errors when DB fails', async () => {
    makeAdminAuth();
    vi.mocked(getDb).mockReturnValue({
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockRejectedValue(new Error('DB down')),
      }),
    } as unknown as ReturnType<typeof getDb>);

    const req = new NextRequest('http://localhost/api/admin/moderation/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', commentIds: ['c1'] }),
    });
    const data = await (await POST(req)).json();
    expect(data.processed).toBe(0);
    expect(data.errors.length).toBeGreaterThan(0);
  });
});
