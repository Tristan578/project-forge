vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb, getNeonSql } from '@/lib/db/client';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');

// published_games.id is a uuid column; the game branch validates the shape.
const GAME_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// `rateLimitAdminRoute` is NOT mocked — the admin bucket is real, in-memory and
// keyed `admin:<endpoint>:<userId>`, so a shared user id makes every test in
// the file spend one another's budget and the suite starts 429ing as cases are
// added. Each test gets its own admin identity instead of the limiter being
// stubbed out, which would remove a real guard from coverage.
let adminSeq = 0;
function nextAdminId(): string {
  adminSeq += 1;
  return `admin-user-${adminSeq}`;
}

/**
 * The queue list and the queue DEPTH are two separate queries (a page's length
 * can never report the backlog), so the GET tests mock `select()` twice: first
 * the paginated list chain, then the `count()` chain.
 */
function countChain(value: number) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ value }]),
  };
}

/**
 * The game approve branch is one raw `getNeonSql()` statement, not a Drizzle
 * update — it has to clear the hold, reset the counter and restore the status
 * conditionally in a single commit (neon-http has no transaction). Returns a
 * tagged-template spy so the test can read the bound values.
 */
function neonSqlSpy(rows: unknown[]) {
  return vi.fn(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      void strings;
      void values;
      return Promise.resolve(rows);
    }
  );
}

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
      const user = makeUser({ id: nextAdminId() });
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
      vi.mocked(assertAdmin).mockReturnValue(mockNextResponse({ error: 'Forbidden' }, { status: 403 }));

      const req = new NextRequest('http://localhost/api/admin/moderation');
      const res = await GET(req);
      expect(res.status).toBe(403);
    });

    it('returns flagged comments', async () => {
      const user = makeUser({ id: nextAdminId() });
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

      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValueOnce(chainMock).mockReturnValueOnce(countChain(42)),
      } as unknown as ReturnType<typeof getDb>);

      const req = new NextRequest('http://localhost/api/admin/moderation?limit=10&offset=0');
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.items.length).toBe(1);
      expect(data.items[0].id).toBe('comment_1');
      // `total` is the queue DEPTH, not this page's length: one item returned,
      // 42 flagged comments waiting.
      expect(data.total).toBe(42);
      expect(data.hasMore).toBe(true);
    });

    it("returns 400 for an unrecognised ?type", async () => {
      const user = makeUser({ id: nextAdminId() });
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
      vi.mocked(assertAdmin).mockReturnValue(null);

      const req = new NextRequest('http://localhost/api/admin/moderation?type=asset');
      const res = await GET(req);

      expect(res.status).toBe(400);
      expect(vi.mocked(getDb)).not.toHaveBeenCalled();
    });

    it('returns 403 for a non-admin on the ?type=game queue, before any DB read', async () => {
      const user = makeUser({ id: nextAdminId() });
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
      vi.mocked(assertAdmin).mockReturnValue(mockNextResponse({ error: 'Forbidden' }, { status: 403 }));

      const req = new NextRequest('http://localhost/api/admin/moderation?type=game');
      const res = await GET(req);

      expect(res.status).toBe(403);
      expect(vi.mocked(getDb)).not.toHaveBeenCalled();
    });

    it('returns flagged games with reportCount, flaggedAt and the creator name', async () => {
      const user = makeUser({ id: nextAdminId() });
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
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValueOnce(chainMock).mockReturnValueOnce(countChain(7)),
      } as unknown as ReturnType<typeof getDb>);

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
      // One game on this page, seven held in the queue. An operator reading
      // `total` to size the backlog must not be shown the page size.
      expect(data.total).toBe(7);
      expect(data.hasMore).toBe(true);
    });

    it('reports hasMore=false once the page reaches the end of the queue', async () => {
      const user = makeUser({ id: nextAdminId() });
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
      vi.mocked(assertAdmin).mockReturnValue(null);

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
          flaggedAt: new Date('2026-05-01T10:00:00.000Z'),
        }]),
      };
      vi.mocked(getDb).mockReturnValue({
        select: vi.fn().mockReturnValueOnce(chainMock).mockReturnValueOnce(countChain(3)),
      } as unknown as ReturnType<typeof getDb>);

      const req = new NextRequest('http://localhost/api/admin/moderation?type=game&offset=2');
      const res = await GET(req);
      const data = await res.json();

      expect(data.total).toBe(3);
      expect(data.hasMore).toBe(false);
    });
  });

  describe('POST', () => {
    it('returns 403 if not admin', async () => {
      const user = makeUser({ id: nextAdminId() });
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
      const user = makeUser({ id: nextAdminId() });
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
      const user = makeUser({ id: nextAdminId() });
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
      const user = makeUser({ id: nextAdminId() });
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
      const user = makeUser({ id: nextAdminId() });
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
      const user = makeUser({ id: nextAdminId() });
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
      const user = makeUser({ id: nextAdminId() });
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

    it('approves a game by lifting the hold, resetting the counter and reporting the resulting status', async () => {
      const user = makeUser({ id: nextAdminId() });
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
      vi.mocked(assertAdmin).mockReturnValue(null);

      const sql = neonSqlSpy([{ id: GAME_ID, status: 'published' }]);
      vi.mocked(getNeonSql).mockReturnValue(sql as unknown as ReturnType<typeof getNeonSql>);
      const deleteSpy = vi.fn();
      const updateSpy = vi.fn();
      vi.mocked(getDb).mockReturnValue({
        update: updateSpy,
        delete: deleteSpy,
      } as unknown as ReturnType<typeof getDb>);

      const req = new NextRequest('http://localhost/api/admin/moderation', {
        method: 'POST',
        body: JSON.stringify({ id: GAME_ID, type: 'game', action: 'approve' }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      // `status` comes from the statement's RETURNING, so the operator sees
      // whether the game went public again or only had its hold lifted.
      expect(data).toEqual({ success: true, action: 'approved', type: 'game', status: 'published' });

      const [strings, ...values] = sql.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
      const statement = strings.join('?');
      // Three effects in ONE statement; neon-http has no transaction to make
      // them atomic any other way. flagged_at is the hold POST /api/publish
      // refuses to republish over, and report_count is per review cycle.
      expect(statement).toContain('flagged_at = NULL');
      expect(statement).toContain('report_count = 0');
      // Conditional restore: a game the CREATOR unpublished while it sat in
      // the queue gets its hold lifted without being republished behind them.
      expect(statement).toMatch(/status = CASE[\s\S]*WHEN status = 'flagged'/);
      expect(statement).toContain('flagged_at IS NOT NULL');
      expect(values).toContain(GAME_ID);

      expect(updateSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('reports the status a creator-unpublished game keeps after its hold is lifted', async () => {
      const user = makeUser({ id: nextAdminId() });
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
      vi.mocked(assertAdmin).mockReturnValue(null);

      const sql = neonSqlSpy([{ id: GAME_ID, status: 'unpublished' }]);
      vi.mocked(getNeonSql).mockReturnValue(sql as unknown as ReturnType<typeof getNeonSql>);

      const req = new NextRequest('http://localhost/api/admin/moderation', {
        method: 'POST',
        body: JSON.stringify({ id: GAME_ID, type: 'game', action: 'approve' }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.status).toBe('unpublished');
    });

    it('404s an approve that matched no HELD game', async () => {
      const user = makeUser({ id: nextAdminId() });
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
      vi.mocked(assertAdmin).mockReturnValue(null);

      const sql = neonSqlSpy([]);
      vi.mocked(getNeonSql).mockReturnValue(sql as unknown as ReturnType<typeof getNeonSql>);

      const req = new NextRequest('http://localhost/api/admin/moderation', {
        method: 'POST',
        body: JSON.stringify({ id: GAME_ID, type: 'game', action: 'approve' }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error).toBe('No held game with that id');
    });

    it('soft-removes a game to unpublished and never hard-deletes the row', async () => {
      const user = makeUser({ id: nextAdminId() });
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
