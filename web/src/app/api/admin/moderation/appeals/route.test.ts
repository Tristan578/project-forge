vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');

describe('/api/admin/moderation/appeals GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const req = new NextRequest('http://localhost/api/admin/moderation/appeals');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 if not admin', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(assertAdmin).mockReturnValue(mockNextResponse({ error: 'Forbidden' }, { status: 403 }));

    const req = new NextRequest('http://localhost/api/admin/moderation/appeals');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('returns pending appeals', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const mockAppeals = [{
      id: 'appeal-1',
      contentId: 'comment-1',
      contentType: 'comment',
      reason: 'Not offensive',
      status: 'pending',
      userId: 'user-1',
      userName: 'TestUser',
      userEmail: 'test@example.com',
      createdAt: new Date(),
      reviewedAt: null,
    }];

    const chainMock = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockResolvedValue(mockAppeals),
    };

    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(chainMock) } as unknown as ReturnType<typeof getDb>);

    const req = new NextRequest('http://localhost/api/admin/moderation/appeals');
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].id).toBe('appeal-1');
    expect(data.items[0].reason).toBe('Not offensive');
  });
});
