vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');

// published_games.id is a uuid column; the game branch validates the shape.
const GAME_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

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

    it("returns 400 for an unrecognised ?type", async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
      vi.mocked(assertAdmin).mockReturnValue(null);

      const req = new NextRequest('http://localhost/api/admin/moderation?type=asset');
      const res = await GET(req);

      expect(res.status).toBe(400);
      expect(vi.mocked(getDb)).not.toHaveBeenCalled();
    });

    it('returns 403 for a non-admin on the ?type=game queue, before any DB read', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
      vi.mocked(assertAdmin).mockReturnValue(mockNextResponse({ error: 'Forbidden' }, { status: 403 }));

      const req = new NextRequest('http://localhost/api/admin/moderation?type=game');
      const res = await GET(req);

      expect(res.status).toBe(403);
      expect(vi.mocked(getDb)).not.toHaveBeenCalled();
    });

    it('returns flagged games with reportCount, flaggedAt and the creator name', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
      vi.mocked(assertAdmin).mockReturnValue(null);

      const flaggedAt = new Date('2026-05-01T10:00:00.000Z');
      const chainMock = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([{
          id: GAME_ID,
          title: 'Naughty Game',
          slug: 'naughty-game',
          authorId: 'user_1',
          authorName: 'Creator',
          authorEmail: 'creator@example.com',
          reportCount: 3,
          flaggedAt,
        }]),
      };
      vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(chainMock) } as unknown as ReturnType<typeof getDb>);

      const req = new NextRequest('http://localhost/api/admin/moderation?type=game');
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.items).toEqual([{
        id: GAME_ID,
        type: 'game',
        gameId: GAME_ID,
        title: 'Naughty Game',
        slug: 'naughty-game',
        authorId: 'user_1',
        authorName: 'Creator',
        authorEmail: 'creator@example.com',
        reportCount: 3,
        flaggedAt: flaggedAt.toISOString(),
      }]);
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

    it('returns 422 for invalid action', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
      vi.mocked(assertAdmin).mockReturnValue(null);

      const req = new NextRequest('http://localhost/api/admin/moderation', {
        method: 'POST',
        body: JSON.stringify({ id: 'comment_1', action: 'ignore' }),
      });
      const res = await POST(req);
      const data = await res.json();
      expect(res.status).toBe(422);
      expect(data.error).toBe('Validation failed');
      expect(JSON.stringify(data.details)).toContain('action');
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

    it('returns 403 for a non-admin on a type=game action, before any DB write', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
      vi.mocked(assertAdmin).mockReturnValue(mockNextResponse({ error: 'Forbidden' }, { status: 403 }));

      const req = new NextRequest('http://localhost/api/admin/moderation', {
        method: 'POST',
        body: JSON.stringify({ id: GAME_ID, type: 'game', action: 'delete' }),
      });
      const res = await POST(req);

      expect(res.status).toBe(403);
      expect(vi.mocked(getDb)).not.toHaveBeenCalled();
    });

    it('returns 422 for an unrecognised type', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
      vi.mocked(assertAdmin).mockReturnValue(null);

      const req = new NextRequest('http://localhost/api/admin/moderation', {
        method: 'POST',
        body: JSON.stringify({ id: GAME_ID, type: 'asset', action: 'approve' }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(422);
      expect(JSON.stringify(data.details)).toContain('type');
    });

    it('returns 404 for a malformed game id without touching the database', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
      vi.mocked(assertAdmin).mockReturnValue(null);

      const req = new NextRequest('http://localhost/api/admin/moderation', {
        method: 'POST',
        body: JSON.stringify({ id: 'game_1', type: 'game', action: 'approve' }),
      });
      const res = await POST(req);

      expect(res.status).toBe(404);
      expect(vi.mocked(getDb)).not.toHaveBeenCalled();
    });

    it('approves a game back to published and clears flaggedAt', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
      vi.mocked(assertAdmin).mockReturnValue(null);

      const mockUpdateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: GAME_ID }]),
      };
      const deleteSpy = vi.fn();
      vi.mocked(getDb).mockReturnValue({
        update: vi.fn().mockReturnValue(mockUpdateChain),
        delete: deleteSpy,
      } as unknown as ReturnType<typeof getDb>);

      const req = new NextRequest('http://localhost/api/admin/moderation', {
        method: 'POST',
        body: JSON.stringify({ id: GAME_ID, type: 'game', action: 'approve' }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual({ success: true, action: 'approved', type: 'game' });
      expect(mockUpdateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'published', flaggedAt: null }),
      );
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('404s an approve that matched no flagged game', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
      vi.mocked(assertAdmin).mockReturnValue(null);

      const mockUpdateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      };
      vi.mocked(getDb).mockReturnValue({
        update: vi.fn().mockReturnValue(mockUpdateChain),
      } as unknown as ReturnType<typeof getDb>);

      const req = new NextRequest('http://localhost/api/admin/moderation', {
        method: 'POST',
        body: JSON.stringify({ id: GAME_ID, type: 'game', action: 'approve' }),
      });
      const res = await POST(req);

      expect(res.status).toBe(404);
    });

    it('soft-removes a game to unpublished and never hard-deletes the row', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
      vi.mocked(assertAdmin).mockReturnValue(null);

      const mockUpdateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: GAME_ID }]),
      };
      const deleteSpy = vi.fn();
      vi.mocked(getDb).mockReturnValue({
        update: vi.fn().mockReturnValue(mockUpdateChain),
        delete: deleteSpy,
      } as unknown as ReturnType<typeof getDb>);

      const req = new NextRequest('http://localhost/api/admin/moderation', {
        method: 'POST',
        body: JSON.stringify({ id: GAME_ID, type: 'game', action: 'delete' }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual({ success: true, action: 'deleted', type: 'game' });
      expect(mockUpdateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'unpublished' }),
      );
      // FK references from game_comments/game_ratings/game_likes/game_reports
      // are NOT NULL with no cascade - a hard delete would throw.
      expect(deleteSpy).not.toHaveBeenCalled();
    });
  });
});
