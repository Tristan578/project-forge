vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');

describe('/api/admin/moderation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET', () => {
    it('returns 401 if unauthenticated', async () => {
      vi.mocked(authenticateRequest).mockResolvedValue({
        ok: false,
        response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
      });

      const req = new NextRequest('http://localhost/api/admin/moderation');
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it('returns 403 if not admin', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
      vi.mocked(assertAdmin).mockReturnValue(mockNextResponse({ error: 'Forbidden' }, { status: 403 }));

      const req = new NextRequest('http://localhost/api/admin/moderation');
      const res = await GET(req);
      expect(res.status).toBe(403);
    });

    it('returns flagged comments', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
      vi.mocked(assertAdmin).mockReturnValue(null);

      const mockComments = [{
        id: 'comment_1',
        content: 'Bad words',
        gameId: 'game_1',
        gameTitle: 'Cool Game',
        authorId: 'user_1',
        authorName: 'Troll',
        authorEmail: 'troll@example.com',
        createdAt: new Date(),
      }];

      const chainMock = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue(mockComments),
      };

      vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(chainMock) } as unknown as ReturnType<typeof getDb>);

      const req = new NextRequest('http://localhost/api/admin/moderation?limit=10&offset=0');
      const res = await GET(req);
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.items.length).toBe(1);
      expect(data.items[0].id).toBe('comment_1');
      expect(data.total).toBe(1);
    });
  });

  describe('POST', () => {
    it('returns 403 if not admin', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
      vi.mocked(assertAdmin).mockReturnValue(mockNextResponse({ error: 'Forbidden' }, { status: 403 }));

      const req = new NextRequest('http://localhost/api/admin/moderation', {
        method: 'POST',
        body: JSON.stringify({ id: 'comment_1', action: 'approve' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
    });

    it('returns 400 for invalid action', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
      vi.mocked(assertAdmin).mockReturnValue(null);

      const req = new NextRequest('http://localhost/api/admin/moderation', {
        method: 'POST',
        body: JSON.stringify({ id: 'comment_1', action: 'ignore' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('approves comment by updating flagged status', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
      vi.mocked(assertAdmin).mockReturnValue(null);

      const mockUpdateChain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(true) };
      vi.mocked(getDb).mockReturnValue({ update: vi.fn().mockReturnValue(mockUpdateChain) } as unknown as ReturnType<typeof getDb>);

      const req = new NextRequest('http://localhost/api/admin/moderation', {
        method: 'POST',
        body: JSON.stringify({ id: 'comment_1', action: 'approve' }),
      });
      const res = await POST(req);
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.action).toBe('approved');
      expect(mockUpdateChain.set).toHaveBeenCalledWith({ flagged: 0 });
    });

    it('deletes comment successfully', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
      vi.mocked(assertAdmin).mockReturnValue(null);

      const mockDeleteChain = { where: vi.fn().mockResolvedValue(true) };
      vi.mocked(getDb).mockReturnValue({ delete: vi.fn().mockReturnValue(mockDeleteChain) } as unknown as ReturnType<typeof getDb>);

      const req = new NextRequest('http://localhost/api/admin/moderation', {
        method: 'POST',
        body: JSON.stringify({ id: 'comment_2', action: 'delete' }),
      });
      const res = await POST(req);
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.action).toBe('deleted');
    });
  });
});
