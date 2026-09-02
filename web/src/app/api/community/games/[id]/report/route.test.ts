vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';
import { getDb, getNeonSql } from '@/lib/db/client';
import { captureException } from '@/lib/monitoring/sentry-server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('@/lib/db/client');
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));

const GAME_ID = '11111111-2222-4333-8444-555555555555';
const USER_ID = '99999999-8888-4777-8666-555555555555';

/** Records every tagged-template call so tests can assert on bound values. */
function makeSqlMock(rows: unknown[]) {
  const calls: { strings: string[]; values: unknown[] }[] = [];
  const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ strings: [...strings], values });
    return Promise.resolve(rows);
  });
  return { sql, calls };
}

function selectingDb(rows: unknown[]) {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return { select: vi.fn().mockReturnValue(selectChain) };
}

function makeRequest(body: unknown, gameId = GAME_ID) {
  return new NextRequest(`http://localhost:3000/api/community/games/${gameId}/report`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/community/games/[id]/report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: {
        clerkId: 'clerk_1',
        user: { id: USER_ID, tier: 'creator', displayName: 'Test' } as never,
      },
    });
    vi.mocked(rateLimit).mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60000,
    });
  });

  it('returns 401 when unauthenticated, without touching the database', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
      }) as never,
    });

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reason: 'spam' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });

    expect(res.status).toBe(401);
    // The point of requireAuth is that no write path is reachable at all.
    expect(vi.mocked(getDb)).not.toHaveBeenCalled();
    expect(vi.mocked(getNeonSql)).not.toHaveBeenCalled();
  });

  it('returns 429 when the report bucket is exhausted, without touching the database', async () => {
    vi.mocked(rateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60000,
    });

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reason: 'spam' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });

    expect(res.status).toBe(429);
    expect(vi.mocked(getDb)).not.toHaveBeenCalled();
    expect(vi.mocked(getNeonSql)).not.toHaveBeenCalled();
  });

  it('rate-limits at 5 requests per 60s, keyed per user', async () => {
    vi.mocked(getDb).mockReturnValue(selectingDb([{ id: GAME_ID }]) as never);
    vi.mocked(getNeonSql).mockReturnValue(makeSqlMock([]).sql as never);

    const { POST } = await import('./route');
    await POST(makeRequest({ reason: 'spam' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });

    expect(vi.mocked(rateLimit)).toHaveBeenCalledWith(`report:${USER_ID}`, 5, 60000);
  });

  it('returns 422 for a reason outside the enum', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reason: 'i_just_dislike_it' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toBe('Validation failed');
    expect(JSON.stringify(body.details)).toContain('reason');
    expect(vi.mocked(getNeonSql)).not.toHaveBeenCalled();
  });

  it('returns 422 when details exceeds 2000 characters', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      makeRequest({ reason: 'other', details: 'x'.repeat(2001) }),
      { params: Promise.resolve({ id: GAME_ID }) }
    );
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(JSON.stringify(body.details)).toContain('details');
    expect(vi.mocked(getNeonSql)).not.toHaveBeenCalled();
  });

  it('returns 404 for a malformed game id before any database access', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reason: 'spam' }, 'not-a-uuid'), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Game not found');
    expect(vi.mocked(getDb)).not.toHaveBeenCalled();
  });

  it('returns 404 when the game does not exist, without writing a report', async () => {
    vi.mocked(getDb).mockReturnValue(selectingDb([]) as never);
    const { sql } = makeSqlMock([]);
    vi.mocked(getNeonSql).mockReturnValue(sql as never);

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reason: 'spam' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Game not found');
    expect(sql).not.toHaveBeenCalled();
  });

  it('reports the game and binds the caller-supplied reason and details', async () => {
    vi.mocked(getDb).mockReturnValue(selectingDb([{ id: GAME_ID }]) as never);
    const { sql, calls } = makeSqlMock([
      { status: 'flagged', report_count: 1, hidden: true },
    ]);
    vi.mocked(getNeonSql).mockReturnValue(sql as never);

    const { POST } = await import('./route');
    const res = await POST(
      makeRequest({ reason: 'copyright', details: '  uses my art  ' }),
      { params: Promise.resolve({ id: GAME_ID }) }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ reported: true, hidden: true, reportCount: 1 });

    expect(calls).toHaveLength(1);
    // The bound values are what actually reach Postgres — assert the reason,
    // the reporter and the trimmed details are among them, not merely that a
    // query ran.
    expect(calls[0].values).toContain('copyright');
    expect(calls[0].values).toContain(USER_ID);
    expect(calls[0].values).toContain('uses my art');
    expect(calls[0].values).toContain(GAME_ID);
  });

  it('binds null when details is omitted', async () => {
    vi.mocked(getDb).mockReturnValue(selectingDb([{ id: GAME_ID }]) as never);
    const { sql, calls } = makeSqlMock([
      { status: 'flagged', report_count: 1, hidden: true },
    ]);
    vi.mocked(getNeonSql).mockReturnValue(sql as never);

    const { POST } = await import('./route');
    await POST(makeRequest({ reason: 'violence' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });

    expect(calls[0].values).toContain(null);
  });

  it('reports hidden:false and duplicate:true when the statement matched no row', async () => {
    vi.mocked(getDb).mockReturnValue(selectingDb([{ id: GAME_ID }]) as never);
    const { sql } = makeSqlMock([]);
    vi.mocked(getNeonSql).mockReturnValue(sql as never);

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reason: 'spam' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ reported: true, hidden: false, duplicate: true });
  });

  it('reports hidden:false when the game was already flagged by someone else', async () => {
    vi.mocked(getDb).mockReturnValue(selectingDb([{ id: GAME_ID }]) as never);
    const { sql } = makeSqlMock([
      { status: 'flagged', report_count: 2, hidden: false },
    ]);
    vi.mocked(getNeonSql).mockReturnValue(sql as never);

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reason: 'spam' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });
    const body = await res.json();

    expect(body).toEqual({ reported: true, hidden: false, reportCount: 2 });
  });

  it('returns 500 and reports to Sentry when the write throws', async () => {
    vi.mocked(getDb).mockReturnValue(selectingDb([{ id: GAME_ID }]) as never);
    vi.mocked(getNeonSql).mockReturnValue(
      vi.fn(() => Promise.reject(new Error('boom'))) as never
    );

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reason: 'spam' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Failed to report game');
    expect(vi.mocked(captureException)).toHaveBeenCalledWith(expect.any(Error), {
      route: '/api/community/games/[id]/report',
    });
  });
});
