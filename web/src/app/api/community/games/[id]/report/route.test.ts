vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';
import { getDb, getNeonSql } from '@/lib/db/client';
import { captureException } from '@/lib/monitoring/sentry-server';
import { checkBotIdGate } from '@/lib/security/botId';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('@/lib/db/client');
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/security/botId', () => ({ checkBotIdGate: vi.fn() }));

// NOTE: `@/lib/rateLimit/distributed` is deliberately NOT mocked. Both buckets
// on this route (the per-reporter one inside withApiMiddleware, and the
// per-game one in the route body) go through distributedRateLimit, which falls
// back to the in-memory rateLimit() above when Upstash is unconfigured. Letting
// that fallback run for real is what makes the two `rateLimit` assertions below
// evidence about the shipped code path rather than about a mock.

const GAME_ID = '11111111-2222-4333-8444-555555555555';
const USER_ID = '99999999-8888-4777-8666-555555555555';
const OWNER_ID = '77777777-6666-4555-8444-333333333333';

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

/** The game exists and belongs to someone other than the reporter. */
function existingGame() {
  return selectingDb([{ id: GAME_ID, userId: OWNER_ID }]);
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
    vi.mocked(checkBotIdGate).mockResolvedValue(null);
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

  it('returns the BotID 403 before spending auth, either rate-limit bucket, or the database', async () => {
    vi.mocked(checkBotIdGate).mockResolvedValue(
      NextResponse.json({ error: 'nope', code: 'BOT_CHECK' }, { status: 403 })
    );

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reason: 'spam' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe('BOT_CHECK');
    // A blocked bot must not consume a bucket it could then deny to the real
    // user behind the same identifier, and must not reach any DB call.
    expect(vi.mocked(rateLimit)).not.toHaveBeenCalled();
    expect(vi.mocked(getDb)).not.toHaveBeenCalled();
    expect(vi.mocked(getNeonSql)).not.toHaveBeenCalled();
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
    vi.mocked(getDb).mockReturnValue(existingGame() as never);
    vi.mocked(getNeonSql).mockReturnValue(makeSqlMock([]).sql as never);

    const { POST } = await import('./route');
    await POST(makeRequest({ reason: 'spam' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });

    expect(vi.mocked(rateLimit)).toHaveBeenCalledWith(`report:${USER_ID}`, 5, 60000);
  });

  it('also rate-limits per GAME, across all reporters', async () => {
    vi.mocked(getDb).mockReturnValue(existingGame() as never);
    vi.mocked(getNeonSql).mockReturnValue(makeSqlMock([]).sql as never);

    const { POST } = await import('./route');
    await POST(makeRequest({ reason: 'spam' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });

    // The per-reporter bucket is no defence against a brigade: N accounts each
    // spending 1 of their 5 requests take a game down without any of them
    // approaching their own limit. This bucket is keyed on the game instead.
    expect(vi.mocked(rateLimit)).toHaveBeenCalledWith(
      `report-game:${GAME_ID}`,
      10,
      3600000
    );
  });

  it('returns 429 without writing when the per-game bucket is exhausted', async () => {
    vi.mocked(getDb).mockReturnValue(existingGame() as never);
    const { sql } = makeSqlMock([]);
    vi.mocked(getNeonSql).mockReturnValue(sql as never);
    // Only the per-game bucket is exhausted — this reporter's own bucket is
    // untouched, which is exactly the brigade shape.
    vi.mocked(rateLimit).mockImplementation(async (key: string) => ({
      allowed: !key.startsWith('report-game:'),
      remaining: 0,
      resetAt: Date.now() + 3600000,
    }));

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reason: 'spam' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });

    expect(res.status).toBe(429);
    expect(sql).not.toHaveBeenCalled();
  });

  it('refuses a self-report with 403 and writes nothing', async () => {
    // The reporter IS the owner of the game.
    vi.mocked(getDb).mockReturnValue(
      selectingDb([{ id: GAME_ID, userId: USER_ID }]) as never
    );
    const { sql } = makeSqlMock([]);
    vi.mocked(getNeonSql).mockReturnValue(sql as never);

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reason: 'spam' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe('SELF_REPORT');
    // A creator's own report would otherwise count as a distinct reporter
    // towards the auto-hide threshold — a free vote per takedown.
    expect(sql).not.toHaveBeenCalled();
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
    // The per-game bucket is only spent once the game is known to exist, so a
    // 404 probe cannot exhaust a real game's budget.
    expect(vi.mocked(rateLimit)).not.toHaveBeenCalledWith(
      `report-game:${GAME_ID}`,
      expect.anything(),
      expect.anything()
    );
  });

  it('reports the game and binds the caller-supplied reason and details', async () => {
    vi.mocked(getDb).mockReturnValue(existingGame() as never);
    const { sql, calls } = makeSqlMock([
      { status: 'flagged', report_count: 3, hidden: true },
    ]);
    vi.mocked(getNeonSql).mockReturnValue(sql as never);

    const { POST } = await import('./route');
    const res = await POST(
      makeRequest({ reason: 'copyright', details: '  uses my art  ' }),
      { params: Promise.resolve({ id: GAME_ID }) }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ reported: true, hidden: true });

    expect(calls).toHaveLength(1);
    // The bound values are what actually reach Postgres — assert the reason,
    // the reporter and the trimmed details are among them, not merely that a
    // query ran.
    expect(calls[0].values).toContain('copyright');
    expect(calls[0].values).toContain(USER_ID);
    expect(calls[0].values).toContain('uses my art');
    expect(calls[0].values).toContain(GAME_ID);
  });

  it('never discloses the report count to the reporter', async () => {
    vi.mocked(getDb).mockReturnValue(existingGame() as never);
    const { sql } = makeSqlMock([
      { status: 'published', report_count: 2, hidden: false },
    ]);
    vi.mocked(getNeonSql).mockReturnValue(sql as never);

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reason: 'spam' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });
    const body = await res.json();

    // `report_count` is moderation metadata about someone else's game. Leaking
    // it lets one report per game per account enumerate the gallery for targets
    // sitting one report below the auto-hide threshold.
    expect(Object.keys(body)).toEqual(['reported', 'hidden']);
    expect(JSON.stringify(body)).not.toContain('2');
  });

  it('binds null when details is omitted', async () => {
    vi.mocked(getDb).mockReturnValue(existingGame() as never);
    const { sql, calls } = makeSqlMock([
      { status: 'flagged', report_count: 3, hidden: true },
    ]);
    vi.mocked(getNeonSql).mockReturnValue(sql as never);

    const { POST } = await import('./route');
    await POST(makeRequest({ reason: 'violence' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });

    expect(calls[0].values).toContain(null);
  });

  it('reports hidden:false and duplicate:true when the insert conflicted', async () => {
    vi.mocked(getDb).mockReturnValue(existingGame() as never);
    // `pre` matched the game, so a row comes back; the ON CONFLICT swallowed
    // the insert, so the `upd` half of the LEFT JOIN is null.
    const { sql } = makeSqlMock([
      { status: null, report_count: null, hidden: null },
    ]);
    vi.mocked(getNeonSql).mockReturnValue(sql as never);

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reason: 'spam' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ reported: true, hidden: false, duplicate: true });
  });

  it('404s rather than claiming a duplicate when the game vanished mid-request', async () => {
    vi.mocked(getDb).mockReturnValue(existingGame() as never);
    // Zero rows now means only one thing: `pre` matched nothing, i.e. the game
    // was deleted between the existence check and the write. Reporting that as
    // a duplicate told the user they had already reported a game that no
    // longer exists, and hid the fact that no report was filed.
    const { sql } = makeSqlMock([]);
    vi.mocked(getNeonSql).mockReturnValue(sql as never);

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reason: 'spam' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'Game not found' });
  });

  it('reports hidden:false when the game was already flagged by someone else', async () => {
    vi.mocked(getDb).mockReturnValue(existingGame() as never);
    const { sql } = makeSqlMock([
      { status: 'flagged', report_count: 4, hidden: false },
    ]);
    vi.mocked(getNeonSql).mockReturnValue(sql as never);

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reason: 'spam' }), {
      params: Promise.resolve({ id: GAME_ID }),
    });
    const body = await res.json();

    expect(body).toEqual({ reported: true, hidden: false });
  });

  it('returns 500 and reports to Sentry when the write throws', async () => {
    vi.mocked(getDb).mockReturnValue(existingGame() as never);
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
