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
 * `report_count + 1`, and two CASE expressions that must flip `status` to
 * 'flagged' on the FIRST reporter and must NOT overwrite `flagged_at` for the
 * second. A mock-based test can only assert on the interpolated query string,
 * which proves nothing about any of that — a query can contain "ON CONFLICT"
 * and still double-count. These tests run the real statement against a real
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

vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));

import { POST } from './route';
import { REPORT_AUTOHIDE_THRESHOLD } from '@/lib/config/moderation';

interface ReportResponse {
  reported?: boolean;
  hidden?: boolean;
  duplicate?: boolean;
  reportCount?: number;
  error?: string;
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

  // The auto-hide semantics asserted below are only the stated acceptance
  // criteria while the threshold is 1. If someone raises it, these tests must
  // be rewritten rather than silently passing against different behaviour.
  it('is pinned to the documented default threshold', () => {
    expect(REPORT_AUTOHIDE_THRESHOLD).toBe(1);
  });

  it('first report flips the game to flagged, stamps flagged_at and counts once', async () => {
    const owner = await seedUser(harness().neonSql);
    const reporter = await seedUser(harness().neonSql);
    const gameId = await seedGame(owner.id);

    const res = await report(gameId, reporter.id, {
      reason: 'copyright',
      details: 'uses my art',
    });

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ reported: true, hidden: true, reportCount: 1 });

    const row = await gameRow(gameId);
    expect(row.status).toBe('flagged');
    expect(Number(row.report_count)).toBe(1);
    expect(row.flagged_at).not.toBeNull();

    const reports = await reportRows(gameId);
    expect(reports).toHaveLength(1);
    expect(reports[0].reporter_id).toBe(reporter.id);
    expect(reports[0].reason).toBe('copyright');
    expect(reports[0].details).toBe('uses my art');
  });

  it('a second report from the SAME reporter inserts nothing and does not double-count', async () => {
    const owner = await seedUser(harness().neonSql);
    const reporter = await seedUser(harness().neonSql);
    const gameId = await seedGame(owner.id);

    await report(gameId, reporter.id);
    const afterFirst = await gameRow(gameId);

    const second = await report(gameId, reporter.id, { reason: 'spam' });

    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ reported: true, hidden: false, duplicate: true });

    const row = await gameRow(gameId);
    expect(Number(row.report_count)).toBe(1);
    expect(row.status).toBe('flagged');
    // Byte-identical: the duplicate must not touch the row at all.
    expect(String(row.flagged_at)).toBe(String(afterFirst.flagged_at));
    expect(String(row.updated_at)).toBe(String(afterFirst.updated_at));
    expect(await reportRows(gameId)).toHaveLength(1);
  });

  it('a DIFFERENT reporter increments the count without re-stamping flagged_at', async () => {
    const owner = await seedUser(harness().neonSql);
    const reporterA = await seedUser(harness().neonSql);
    const reporterB = await seedUser(harness().neonSql);
    const gameId = await seedGame(owner.id);

    await report(gameId, reporterA.id);
    const afterFirst = await gameRow(gameId);

    const second = await report(gameId, reporterB.id, { reason: 'hate_speech' });

    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ reported: true, hidden: false, reportCount: 2 });

    const row = await gameRow(gameId);
    expect(Number(row.report_count)).toBe(2);
    expect(row.status).toBe('flagged');
    expect(String(row.flagged_at)).toBe(String(afterFirst.flagged_at));
    expect(await reportRows(gameId)).toHaveLength(2);
  });

  it('reporting an already-unpublished game counts it but does not resurrect it as flagged', async () => {
    const owner = await seedUser(harness().neonSql);
    const reporter = await seedUser(harness().neonSql);
    const gameId = await seedGame(owner.id, 'unpublished');

    const res = await report(gameId, reporter.id);

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ reported: true, hidden: false, reportCount: 1 });

    const row = await gameRow(gameId);
    expect(row.status).toBe('unpublished');
    expect(Number(row.report_count)).toBe(1);
    expect(row.flagged_at).toBeNull();
    expect(await reportRows(gameId)).toHaveLength(1);
  });

  it('404s an unknown game id without inserting a report', async () => {
    const reporter = await seedUser(harness().neonSql);
    const res = await report(randomUUID(), reporter.id);

    expect(res.status).toBe(404);
    expect(res.json.error).toBe('Game not found');

    const rows = await harness().neonSql`SELECT count(*)::int AS n FROM game_reports`;
    expect(Number(rows[0].n)).toBe(0);
  });

  it('404s a malformed (non-uuid) game id before touching the database', async () => {
    const reporter = await seedUser(harness().neonSql);
    const res = await report('not-a-uuid', reporter.id);

    expect(res.status).toBe(404);
    expect(res.json.error).toBe('Game not found');
  });

  it('an admin approve restores the game and a later report re-hides it', async () => {
    const owner = await seedUser(harness().neonSql);
    const reporterA = await seedUser(harness().neonSql);
    const reporterB = await seedUser(harness().neonSql);
    const gameId = await seedGame(owner.id);

    await report(gameId, reporterA.id);

    // What the admin queue's approve branch does (asserted directly here so
    // the round-trip through 'flagged' and back is covered end to end).
    await harness().neonSql`
      UPDATE published_games SET status = 'published', flagged_at = NULL
      WHERE id = ${gameId}::uuid
    `;

    const second = await report(gameId, reporterB.id);
    expect(second.json).toMatchObject({ hidden: true, reportCount: 2 });

    const row = await gameRow(gameId);
    expect(row.status).toBe('flagged');
    // report_count is deliberately monotonic — approving does not erase the
    // moderation history of a repeatedly-reported game.
    expect(Number(row.report_count)).toBe(2);
    expect(row.flagged_at).not.toBeNull();
  });
});
