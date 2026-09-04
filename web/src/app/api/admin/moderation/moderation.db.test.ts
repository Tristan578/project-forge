// @vitest-environment node
// (pgliteHarness resolves web/drizzle/ via import.meta.url, which is not a
// file:// URL under the jsdom default of the standalone vitest.config.ts —
// same docblock pattern as report.db.test.ts.)
/**
 * POST /api/admin/moderation — REAL Postgres proof that a takedown STICKS (#8354).
 *
 * WHY THIS EXISTS
 * ---------------
 * The `delete` action is a soft removal: it sets `status = 'unpublished'` and
 * never deletes the row (game_comments / game_ratings / game_likes /
 * game_reports all hold NOT NULL foreign keys with no cascade). What makes that
 * removal *stick* is not the status — POST /api/publish rewrites `status` to
 * 'published' on any republish — it is `flagged_at`, the one field the publish
 * route refuses to write over. `published_games.flagged_at`'s own schema comment
 * states the invariant: "an admin takedown leaves the row 'unpublished' with the
 * hold still on".
 *
 * That held for a game the auto-hide had already flagged, and only for that
 * game. The action is keyed on a game id alone and the queue is not the only way
 * an operator reaches it — a takedown driven by an out-of-band report (abuse
 * mail, a DMCA notice, a game found while browsing) targets a row that never
 * crossed the report threshold, so `flagged_at` was NULL and stayed NULL. The
 * creator undid the takedown by re-POSTing the same slug: one call, back to
 * 'published'.
 *
 * The sibling mock suite (`route.test.ts`) stubs the Drizzle chain, so it can
 * assert what `.set()` was called with and nothing about the row that results,
 * or about what the publish route then does with that row. These tests run both
 * real statements against real Postgres (PGlite, schema replayed from
 * web/drizzle/*.sql) and assert on the ROW STATE across the two routes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createTestHarness,
  seedUser,
  type TestHarness,
  type QueryRow,
  type SeededUser,
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

// Whoever the middleware resolved; swapped per call.
const currentUser = vi.hoisted(() => ({
  value: null as unknown as { id: string; clerkId: string; tier: string },
}));

vi.mock('@/lib/api/middleware', () => ({
  withApiMiddleware: async (req: { json: () => Promise<unknown> }) => ({
    error: undefined,
    userId: currentUser.value.id,
    authContext: {
      clerkId: currentUser.value.clerkId,
      user: { id: currentUser.value.id, tier: currentUser.value.tier },
    },
    body: await req.json(),
  }),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));

import { POST as moderationPOST } from './route';
import { POST as publishPOST } from '../../publish/route';

// `assertAdmin` is NOT mocked — it reads ADMIN_USER_IDS, so the real admin gate
// stays in the path and this clerk id is what satisfies it. The admin's *user*
// id is fresh per call instead, because `rateLimitAdminRoute` keys its bucket
// `admin:<endpoint>:<userId>` and a shared id makes the cases in this file
// spend one another's budget (10/60s) as more are added.
const ADMIN_CLERK_ID = 'clerk_admin_moderator';
let savedAdminIds: string | undefined;

interface ModerationResponse {
  success?: boolean;
  action?: string;
  error?: string;
}

interface PublishResponse {
  publication?: { id: string; slug: string; status: string; version: number };
  error?: string;
  code?: string;
}

function makeRequest(body: unknown) {
  return {
    json: async () => body,
    headers: new Headers(),
    url: 'http://localhost:3000/api/admin/moderation',
  } as never;
}

/** POST /api/admin/moderation as an admin. */
async function moderate(
  body: Record<string, unknown>
): Promise<{ status: number; json: ModerationResponse }> {
  currentUser.value = { id: randomUUID(), clerkId: ADMIN_CLERK_ID, tier: 'pro' };
  const res = await moderationPOST(makeRequest(body));
  return { status: res.status, json: (await res.json()) as ModerationResponse };
}

/** POST /api/publish as the game's creator. */
async function publish(
  user: SeededUser,
  body: Record<string, unknown>
): Promise<{ status: number; json: PublishResponse }> {
  currentUser.value = { id: user.id, clerkId: user.clerkId, tier: user.tier };
  const res = await publishPOST(makeRequest(body));
  return { status: res.status, json: (await res.json()) as PublishResponse };
}

async function seedProject(ownerId: string): Promise<string> {
  const projectId = randomUUID();
  await harness().neonSql`
    INSERT INTO projects (id, user_id, name, scene_data)
    VALUES (${projectId}::uuid, ${ownerId}::uuid, 'Test Project', '{}'::jsonb)
  `;
  return projectId;
}

/** `flaggedAt` non-null means the auto-hide already put this game on hold. */
async function seedPublication(opts: {
  ownerId: string;
  projectId: string;
  slug: string;
  status?: string;
  flaggedAt?: string | null;
}): Promise<string> {
  const gameId = randomUUID();
  await harness().neonSql`
    INSERT INTO published_games
      (id, user_id, project_id, slug, title, status, flagged_at, report_count)
    VALUES (
      ${gameId}::uuid, ${opts.ownerId}::uuid, ${opts.projectId}::uuid,
      ${opts.slug}, 'Test Game', ${opts.status ?? 'published'}::publish_status,
      ${opts.flaggedAt ?? null},
      ${opts.flaggedAt ? 3 : 0}
    )
  `;
  return gameId;
}

async function gameRow(gameId: string): Promise<QueryRow> {
  const rows = await harness().neonSql`
    SELECT id, slug, status, flagged_at FROM published_games WHERE id = ${gameId}::uuid
  `;
  expect(rows).toHaveLength(1);
  return rows[0];
}

function publishBody(over: Record<string, unknown> = {}) {
  return {
    projectId: randomUUID(),
    title: 'My Awesome Game',
    slug: 'my-awesome-game',
    description: 'A description of the game',
    tags: ['platformer'],
    ...over,
  };
}

describe('POST /api/admin/moderation — game takedown against real Postgres', () => {
  beforeAll(async () => {
    harnessRef.current = await createTestHarness();
    savedAdminIds = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = ADMIN_CLERK_ID;
  });

  afterAll(async () => {
    if (savedAdminIds === undefined) delete process.env.ADMIN_USER_IDS;
    else process.env.ADMIN_USER_IDS = savedAdminIds;
    await harnessRef.current?.close();
  });

  beforeEach(async () => {
    await harness().truncateAll();
  });

  it('puts a game that was never flagged on hold, so the creator cannot republish it', async () => {
    // The out-of-band takedown: an operator acts on a game that never crossed
    // the auto-hide threshold, so there is no `flagged_at` for the removal to
    // inherit.
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);
    const gameId = await seedPublication({
      ownerId: owner.id,
      projectId,
      slug: 'taken-down',
      status: 'published',
    });

    const takedown = await moderate({ id: gameId, type: 'game', action: 'delete' });
    expect(takedown.status).toBe(200);
    expect(takedown.json.action).toBe('deleted');

    const removed = await gameRow(gameId);
    expect(removed.status).toBe('unpublished');
    expect(removed.flagged_at).not.toBeNull();

    // The decisive half: the creator re-POSTs the slug they still own. Without
    // the hold this is a one-call undo of the takedown — the republish branch
    // sets status back to 'published' unconditionally.
    const republish = await publish(owner, publishBody({ projectId, slug: 'taken-down' }));

    expect(republish.status).toBe(403);
    expect(republish.json.code).toBe('MODERATION_HOLD');
    expect((await gameRow(gameId)).status).toBe('unpublished');
  });

  it('keeps the original flag time when taking down a game already on hold', async () => {
    // The hold doubles as the takedown record, so a game auto-hidden on the 1st
    // and removed by an operator on the 5th must still read as flagged on the
    // 1st. Re-stamping would erase when moderation actually began.
    const flaggedAt = '2026-05-01T00:00:00.000Z';
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);
    const gameId = await seedPublication({
      ownerId: owner.id,
      projectId,
      slug: 'already-held',
      status: 'flagged',
      flaggedAt,
    });

    const takedown = await moderate({ id: gameId, type: 'game', action: 'delete' });
    expect(takedown.status).toBe(200);

    const removed = await gameRow(gameId);
    expect(removed.status).toBe('unpublished');
    expect(new Date(removed.flagged_at as string).toISOString()).toBe(flaggedAt);
  });

  it('lifts the hold on approve, so an operator can undo their own takedown', async () => {
    // The takedown must be reversible by the same route that imposed it, or
    // stamping `flagged_at` would strand every out-of-band removal. Approve
    // clears the hold; the CASE leaves the row down, because a takedown is not
    // a republish.
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);
    const gameId = await seedPublication({
      ownerId: owner.id,
      projectId,
      slug: 'restored-slug',
      status: 'published',
    });

    await moderate({ id: gameId, type: 'game', action: 'delete' });
    const approved = await moderate({ id: gameId, type: 'game', action: 'approve' });
    expect(approved.status).toBe(200);

    const lifted = await gameRow(gameId);
    expect(lifted.flagged_at).toBeNull();
    expect(lifted.status).toBe('unpublished');

    // Hold gone, so the creator's republish goes through again.
    const republish = await publish(owner, publishBody({ projectId, slug: 'restored-slug' }));
    expect(republish.status).toBe(200);
    expect(republish.json.publication?.status).toBe('published');
  });
});
