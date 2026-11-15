// @vitest-environment node
// (pgliteHarness resolves web/drizzle/ via import.meta.url, which is not a
// file:// URL under the jsdom default of the standalone vitest.config.ts —
// same docblock pattern as creditAddonTokens.db.test.ts.)
/**
 * POST /api/community/games/[id]/report — REAL Postgres behavioural tests (#8354).
 *
 * WHY THIS EXISTS
 * ---------------
 * The whole correctness of this route lives in ONE SQL statement: an
 * `ON CONFLICT (game_id, reporter_id) DO NOTHING` insert, a SQL-side
 * `report_count + 1` that is gated on the row being `published`, and CASE
 * expressions that must flip `status` to 'flagged' on the reporter that crosses
 * REPORT_AUTOHIDE_THRESHOLD and must NOT re-stamp `flagged_at` afterwards. A
 * mock-based test can only assert on the interpolated query string, which
 * proves nothing about any of that — a query can contain "ON CONFLICT" and
 * still double-count. These tests run the real statement against a real
 * Postgres (PGlite, schema built by replaying web/drizzle/*.sql) and assert on
 * the resulting ROW STATE.
 *
 * The route's auth/rate-limit/validation branches are covered by the sibling
 * mock-based `route.test.ts`; this file is about the SQL.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createTestHarness,
  seedUser,
  type TestHarness,
  type QueryRow,
} from '@/lib/db/__tests__/pgliteHarness';

vi.mock('server-only', () => ({}));

const harnessRef = vi.hoisted(() => ({ current: null as unknown as TestHarness }));
function harness(): TestHarness {
  if (!harnessRef.current) throw new Error('harness not initialised');
  return harnessRef.current;
}

vi.mock('@/lib/db/client', () => ({
  getDb: () => harness().db,
  getNeonSql: () => harness().neonSql,
  queryWithResilience: (fn: () => Promise<unknown>) => fn(),
}));

// The reporter identity is whatever the middleware resolved; swap it per test.
const currentReporter = vi.hoisted(() => ({ id: '' }));

vi.mock('@/lib/api/middleware', () => ({
  withApiMiddleware: async (req: { json: () => Promise<unknown> }) => ({
    error: undefined,
    userId: currentReporter.id,
    authContext: { clerkId: `clerk_${currentReporter.id}`, user: { id: currentReporter.id } },
    body: await req.json(),
  }),
}));

// The bot gate and the per-game bucket are transport concerns asserted in
// route.test.ts. Here they must never be the reason a case does not reach the
// SQL — a silently-limited request would make every row assertion below pass
// vacuously.
vi.mock('@/lib/security/botId', () => ({ checkBotIdGate: vi.fn(async () => null) }));
vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetAt: Date.now() })),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));

import { POST } from './route';
import { REPORT_AUTOHIDE_THRESHOLD } from '@/lib/config/moderation';

interface ReportResponse {
  reported?: boolean;
  hidden?: boolean;
  duplicate?: boolean;
  error?: string;
  code?: string;
}

function makeRequest(gameId: string, body: unknown) {
  return {
    json: async () => body,
    url: `http://localhost:3000/api/community/games/${gameId}/report`,
  } as never;
}

async function report(
  gameId: string,
  reporterId: string,
  body: unknown = { reason: 'copyright' }
): Promise<{ status: number; json: ReportResponse }> {
  currentReporter.id = reporterId;
  const res = await POST(makeRequest(gameId, body), {
    params: Promise.resolve({ id: gameId }),
  });
  return { status: res.status, json: (await res.json()) as ReportResponse };
}

/** Insert a project + published game owned by `ownerId`; returns the game id. */
async function seedGame(ownerId: string, status = 'published'): Promise<string> {
  const sql = harness().neonSql;
  const projectId = randomUUID();
  const gameId = randomUUID();
  await sql`
    INSERT INTO projects (id, user_id, name, scene_data)
    VALUES (${projectId}::uuid, ${ownerId}::uuid, 'Test Project', '{}'::jsonb)
  `;
  await sql`
    INSERT INTO published_games (id, user_id, project_id, slug, title, status)
    VALUES (${gameId}::uuid, ${ownerId}::uuid, ${projectId}::uuid,
            ${`slug-${gameId.slice(0, 8)}`}, 'Test Game', ${status}::publish_status)
  `;
  return gameId;
}

/** N distinct reporter accounts, none of them the creator. */
async function seedReporters(n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    ids.push((await seedUser(harness().neonSql)).id);
  }
  return ids;
}

async function gameRow(gameId: string): Promise<QueryRow> {
  const rows = await harness().neonSql`
    SELECT status, report_count, flagged_at, updated_at
    FROM published_games WHERE id = ${gameId}::uuid
  `;
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function reportRows(gameId: string): Promise<QueryRow[]> {
  return harness().neonSql`
    SELECT reporter_id, reason, details
    FROM game_reports WHERE game_id = ${gameId}::uuid ORDER BY created_at
  `;
}

describe('POST /api/community/games/[id]/report — real Postgres', () => {
  beforeAll(async () => {
    harnessRef.current = await createTestHarness();
  });

  afterAll(async () => {
    await harnessRef.current?.close();
  });

  beforeEach(async () => {
    await harness().truncateAll();
  });

  // Every case below encodes the literal 3 (two reports that must NOT hide,
  // a third that must). If the constant moves, those cases would start
  // asserting behaviour the product no longer has — fail here instead of
  // passing quietly against a different threshold.
  it('is pinned to the documented default threshold', () => {
    expect(REPORT_AUTOHIDE_THRESHOLD).toBe(3);
  });

  it('a report below the threshold is recorded and counted but does NOT hide the game', async () => {
    const owner = await seedUser(harness().neonSql);
    const [reporter] = await seedReporters(1);
    const gameId = await seedGame(owner.id);

    const res = await report(gameId, reporter, {
      reason: 'copyright',
      details: 'uses my art',
    });

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ reported: true, hidden: false });

    const row = await gameRow(gameId);
    expect(row.status).toBe('published');
    expect(Number(row.report_count)).toBe(1);
    expect(row.flagged_at).toBeNull();

    const reports = await reportRows(gameId);
    expect(reports).toHaveLength(1);
    expect(reports[0].reporter_id).toBe(reporter);
    expect(reports[0].reason).toBe('copyright');
    expect(reports[0].details).toBe('uses my art');
  });

  it('the THIRD distinct reporter crosses the threshold, flips to flagged and stamps flagged_at', async () => {
    const owner = await seedUser(harness().neonSql);
    const [a, b, c] = await seedReporters(3);
    const gameId = await seedGame(owner.id);

    expect((await report(gameId, a)).json.hidden).toBe(false);
    expect((await report(gameId, b)).json.hidden).toBe(false);
    // Still public after two reports — this is the assertion a threshold of 1
    // could never satisfy.
    const beforeThird = await gameRow(gameId);
    expect(beforeThird.status).toBe('published');
    expect(Number(beforeThird.report_count)).toBe(2);
    expect(beforeThird.flagged_at).toBeNull();

    const third = await report(gameId, c, { reason: 'hate_speech' });
    expect(third.status).toBe(200);
    expect(third.json).toEqual({ reported: true, hidden: true });

    const row = await gameRow(gameId);
    expect(row.status).toBe('flagged');
    expect(Number(row.report_count)).toBe(3);
    expect(row.flagged_at).not.toBeNull();
    expect(await reportRows(gameId)).toHaveLength(3);
  });

  it('a second report from the SAME reporter inserts nothing and does not double-count', async () => {
    const owner = await seedUser(harness().neonSql);
    const [reporter] = await seedReporters(1);
    const gameId = await seedGame(owner.id);

    await report(gameId, reporter);
    const afterFirst = await gameRow(gameId);

    const second = await report(gameId, reporter, { reason: 'spam' });

    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ reported: true, hidden: false, duplicate: true });

    const row = await gameRow(gameId);
    expect(Number(row.report_count)).toBe(1);
    expect(row.status).toBe('published');
    // Byte-identical: the duplicate must not touch the row at all.
    expect(String(row.updated_at)).toBe(String(afterFirst.updated_at));
    expect(await reportRows(gameId)).toHaveLength(1);
  });

  it('a report against an ALREADY-flagged game is recorded but neither counted nor re-stamped', async () => {
    const owner = await seedUser(harness().neonSql);
    const [a, b, c, d] = await seedReporters(4);
    const gameId = await seedGame(owner.id);

    await report(gameId, a);
    await report(gameId, b);
    await report(gameId, c);
    const afterHide = await gameRow(gameId);
    expect(afterHide.status).toBe('flagged');

    const fourth = await report(gameId, d);
    expect(fourth.status).toBe(200);
    expect(fourth.json).toEqual({ reported: true, hidden: false });

    const row = await gameRow(gameId);
    expect(row.status).toBe('flagged');
    // The counter is scoped to the CURRENT review cycle, so a game already in
    // the queue does not keep accruing towards the next one.
    expect(Number(row.report_count)).toBe(3);
    expect(String(row.flagged_at)).toBe(String(afterHide.flagged_at));
    // The moderator still sees every report, including the fourth.
    expect(await reportRows(gameId)).toHaveLength(4);
  });

  it('reporting an already-unpublished game records the report without counting it', async () => {
    const owner = await seedUser(harness().neonSql);
    const [reporter] = await seedReporters(1);
    const gameId = await seedGame(owner.id, 'unpublished');

    const res = await report(gameId, reporter);

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ reported: true, hidden: false });

    const row = await gameRow(gameId);
    expect(row.status).toBe('unpublished');
    expect(Number(row.report_count)).toBe(0);
    expect(row.flagged_at).toBeNull();
    expect(await reportRows(gameId)).toHaveLength(1);
  });

  it('reports BANKED while a game is unpublished cannot hide it the moment it is republished', async () => {
    const owner = await seedUser(harness().neonSql);
    const [a, b, c, d] = await seedReporters(4);
    const gameId = await seedGame(owner.id, 'unpublished');

    // A brigade files the full threshold against a game nobody can see.
    await report(gameId, a);
    await report(gameId, b);
    await report(gameId, c);
    expect(Number((await gameRow(gameId)).report_count)).toBe(0);

    // The creator republishes.
    await harness().neonSql`
      UPDATE published_games SET status = 'published' WHERE id = ${gameId}::uuid
    `;

    // The next report starts the cycle from zero rather than tipping a
    // pre-loaded counter over the threshold on request one.
    const res = await report(gameId, d);
    expect(res.json).toEqual({ reported: true, hidden: false });

    const row = await gameRow(gameId);
    expect(row.status).toBe('published');
    expect(Number(row.report_count)).toBe(1);
    expect(row.flagged_at).toBeNull();
  });

  it('rejects a creator reporting their own game, and records nothing', async () => {
    const owner = await seedUser(harness().neonSql);
    const gameId = await seedGame(owner.id);

    const res = await report(gameId, owner.id);

    expect(res.status).toBe(403);
    expect(res.json.code).toBe('SELF_REPORT');

    const row = await gameRow(gameId);
    expect(row.status).toBe('published');
    expect(Number(row.report_count)).toBe(0);
    expect(await reportRows(gameId)).toHaveLength(0);
  });

  it('404s an unknown game id without inserting a report', async () => {
    const [reporter] = await seedReporters(1);
    const res = await report(randomUUID(), reporter);

    expect(res.status).toBe(404);
    expect(res.json.error).toBe('Game not found');

    const rows = await harness().neonSql`SELECT count(*)::int AS n FROM game_reports`;
    expect(Number(rows[0].n)).toBe(0);
  });

  it('404s a malformed (non-uuid) game id before touching the database', async () => {
    const [reporter] = await seedReporters(1);
    const res = await report('not-a-uuid', reporter);

    expect(res.status).toBe(404);
    expect(res.json.error).toBe('Game not found');
  });
});
