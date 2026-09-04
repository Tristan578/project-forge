vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb, getNeonSql } from '@/lib/db/client';
import { eq, and } from 'drizzle-orm';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');
// Spy on the comparison builders so we can assert the unflag UPDATE is scoped
// to the appellant's own comment (defense-in-depth, #8613). The .where() mock
// is a passthrough, so the filter is only observable on eq/and call args.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return { ...actual, eq: vi.fn(actual.eq), and: vi.fn(actual.and) };
});

function makeReviewRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/moderation/appeals/appeal-1/review', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const makeParams = () => Promise.resolve({ id: 'appeal-1' });

// published_games.id is a uuid column; the game restore validates the shape.
const GAME_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/**
 * The game restore is one raw `getNeonSql()` statement (conditional status
 * CASE + hold clear + counter reset in a single commit — neon-http has no
 * transaction), so it is observable on the tagged-template call, not on
 * Drizzle's `.set()`. Returns a spy over `rows`.
 */
function neonSqlSpy(rows: unknown[]) {
  return vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    void strings;
    void values;
    return Promise.resolve(rows);
  });
}

function makeMockDb(selectResults: unknown[]) {
  const updateSetWhere = vi.fn().mockResolvedValue(true);
  const updateSet = vi.fn().mockReturnValue({ where: updateSetWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  const selectLimit = vi.fn().mockResolvedValue(selectResults);
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

  return { select: selectFn, update: updateFn };
}

describe('/api/admin/moderation/appeals/[id]/review POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 if not admin', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(assertAdmin).mockReturnValue(mockNextResponse({ error: 'Forbidden' }, { status: 403 }));

    const res = await POST(makeReviewRequest({ decision: 'approve' }), { params: makeParams() });
    expect(res.status).toBe(403);
  });

  it('returns 422 for invalid decision', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const res = await POST(makeReviewRequest({ decision: 'maybe' }), { params: makeParams() });
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
    expect(JSON.stringify(data.details)).toContain('decision');
  });

  it('returns 404 if appeal not found', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    vi.mocked(getDb).mockReturnValue(makeMockDb([]) as unknown as ReturnType<typeof getDb>);

    const res = await POST(makeReviewRequest({ decision: 'approve' }), { params: makeParams() });
    expect(res.status).toBe(404);
  });

  it('returns 409 if appeal already reviewed', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    vi.mocked(getDb).mockReturnValue(makeMockDb([
      { id: 'appeal-1', status: 'approved', contentType: 'comment', contentId: 'c1' },
    ]) as unknown as ReturnType<typeof getDb>);

    const res = await POST(makeReviewRequest({ decision: 'approve' }), { params: makeParams() });
    expect(res.status).toBe(409);
  });

  it('approves appeal and unflags comment, scoped to the appellant', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    vi.mocked(getDb).mockReturnValue(makeMockDb([
      { id: 'appeal-1', userId: 'author-1', status: 'pending', contentType: 'comment', contentId: 'comment-1' },
    ]) as unknown as ReturnType<typeof getDb>);

    const res = await POST(makeReviewRequest({ decision: 'approve', note: 'Content is fine' }), { params: makeParams() });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.status).toBe('approved');
    // The unflag UPDATE must re-confirm the appellant authored the comment, so
    // a forged/stale appeal cannot unflag a comment its filer never owned.
    expect(vi.mocked(and)).toHaveBeenCalled();
    expect(vi.mocked(eq)).toHaveBeenCalledWith(expect.anything(), 'author-1');
  });

  it('approves a GAME appeal by lifting the hold, scoped to the owner, and says so', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const db = makeMockDb([
      { id: 'appeal-1', userId: 'author-1', status: 'pending', contentType: 'game', contentId: GAME_ID },
    ]);
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
    const sql = neonSqlSpy([{ id: GAME_ID }]);
    vi.mocked(getNeonSql).mockReturnValue(sql as unknown as ReturnType<typeof getNeonSql>);

    const res = await POST(makeReviewRequest({ decision: 'approve' }), { params: makeParams() });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('approved');
    // The creator is told the restore actually happened, not just that the
    // appeal was marked approved.
    expect(data.gameRestored).toBe(true);

    const [strings, ...values] = sql.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const statement = strings.join('?');
    expect(statement).toContain('flagged_at = NULL');
    expect(statement).toContain('report_count = 0');
    // Conditional restore: winning an appeal republishes a row that was
    // 'flagged', and only lifts the hold on one the creator took down.
    expect(statement).toMatch(/status = CASE[\s\S]*WHEN status = 'flagged'/);
    // Matched on the HOLD, not on the status, so a creator who unpublished
    // while the appeal was open is not stranded behind a permanent flagged_at.
    expect(statement).toContain('flagged_at IS NOT NULL');
    // Ownership re-confirmed, so a forged appeal cannot free someone else's game.
    expect(statement).toContain('user_id = ');
    expect(values).toEqual([GAME_ID, 'author-1']);
  });

  it('reports gameRestored:false and warns when an approved restore matched no row', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    vi.mocked(getDb).mockReturnValue(makeMockDb([
      { id: 'appeal-1', userId: 'author-1', status: 'pending', contentType: 'game', contentId: GAME_ID },
    ]) as unknown as ReturnType<typeof getDb>);
    vi.mocked(getNeonSql).mockReturnValue(
      neonSqlSpy([]) as unknown as ReturnType<typeof getNeonSql>
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await POST(makeReviewRequest({ decision: 'approve' }), { params: makeParams() });
    const data = await res.json();

    expect(res.status).toBe(200);
    // "approved" with nothing restored is the failure mode worth surfacing: the
    // creator is told they won and the game is still held.
    expect(data.gameRestored).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('restored no row'),
      expect.objectContaining({ contentId: GAME_ID })
    );
    warn.mockRestore();
  });

  it('does not touch published_games when a game appeal carries a non-uuid contentId', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const db = makeMockDb([
      { id: 'appeal-1', userId: 'author-1', status: 'pending', contentType: 'game', contentId: 'game_1' },
    ]);
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
    const sql = neonSqlSpy([{ id: GAME_ID }]);
    vi.mocked(getNeonSql).mockReturnValue(sql as unknown as ReturnType<typeof getNeonSql>);

    const res = await POST(makeReviewRequest({ decision: 'approve' }), { params: makeParams() });
    const data = await res.json();

    expect(res.status).toBe(200);
    // Only the appeal row is updated — the restore statement never runs, so
    // `gameRestored` is absent rather than a misleading `false`.
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(sql).not.toHaveBeenCalled();
    expect(data.gameRestored).toBeUndefined();
  });

  it('rejecting a game appeal leaves the game hidden', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const db = makeMockDb([
      { id: 'appeal-1', userId: 'author-1', status: 'pending', contentType: 'game', contentId: GAME_ID },
    ]);
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
    const sql = neonSqlSpy([{ id: GAME_ID }]);
    vi.mocked(getNeonSql).mockReturnValue(sql as unknown as ReturnType<typeof getNeonSql>);

    const res = await POST(makeReviewRequest({ decision: 'reject' }), { params: makeParams() });
    const data = await res.json();

    expect(data.status).toBe('rejected');
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(sql).not.toHaveBeenCalled();
  });

  it('rejects appeal without unflagging content', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    vi.mocked(getDb).mockReturnValue(makeMockDb([
      { id: 'appeal-1', status: 'pending', contentType: 'comment', contentId: 'comment-1' },
    ]) as unknown as ReturnType<typeof getDb>);

    const res = await POST(makeReviewRequest({ decision: 'reject' }), { params: makeParams() });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.status).toBe('rejected');
  });
});
