// @vitest-environment node
// (pgliteHarness resolves web/drizzle/ via import.meta.url, which is not a
// file:// URL under the jsdom default of the standalone vitest.config.ts —
// same docblock pattern as report.db.test.ts.)
/**
 * POST /api/publish — REAL Postgres proof of the moderation-hold predicate (#8354).
 *
 * WHY THIS EXISTS
 * ---------------
 * The takedown bypass fixed in this PR lives entirely in one WHERE clause:
 *
 *   user_id = $me AND (slug = $slug OR (project_id = $project AND flagged_at IS NOT NULL))
 *
 * The sibling mock suite (`__tests__/route.test.ts`) stubs `.where()` as a
 * passthrough, so it can prove what the route DOES with the rows it gets back
 * and nothing at all about which rows the query selects. That is exactly the
 * half the bug was in: the old query was slug-scoped, so republishing a
 * taken-down project under a NEW slug returned zero rows, skipped the hold, and
 * inserted a fresh `published` row with `flagged_at` NULL — a one-call
 * platform-wide undo of any takedown.
 *
 * These tests run the real statement against real Postgres (PGlite, schema
 * replayed from web/drizzle/*.sql) and assert on the resulting ROW STATE. They
 * also pin the two ways the predicate could over-block: another creator's held
 * game, and another project of the same creator.
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

// Whoever the middleware resolved; swapped per test.
const currentUser = vi.hoisted(() => ({
  value: null as unknown as { id: string; clerkId: string; tier: string },
}));

vi.mock('@/lib/api/middleware', () => ({
  withApiMiddleware: async (req: { json: () => Promise<unknown> }) => ({
    error: undefined,
    authContext: {
      clerkId: currentUser.value.clerkId,
      user: { id: currentUser.value.id, tier: currentUser.value.tier },
    },
    body: await req.json(),
  }),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));

import { POST } from './route';

interface PublishResponse {
  publication?: { id: string; slug: string; status: string; version: number };
  error?: string;
  code?: string;
}

function makeRequest(body: unknown) {
  return {
    json: async () => body,
    headers: new Headers(),
    url: 'http://localhost:3000/api/publish',
  } as never;
}

async function publish(
  user: SeededUser,
  body: Record<string, unknown>
): Promise<{ status: number; json: PublishResponse }> {
  currentUser.value = { id: user.id, clerkId: user.clerkId, tier: user.tier };
  const res = await POST(makeRequest(body));
  return { status: res.status, json: (await res.json()) as PublishResponse };
}

/** A project owned by `ownerId`. Returns its (uuid) id. */
async function seedProject(ownerId: string): Promise<string> {
  const projectId = randomUUID();
  await harness().neonSql`
    INSERT INTO projects (id, user_id, name, scene_data)
    VALUES (${projectId}::uuid, ${ownerId}::uuid, 'Test Project', '{}'::jsonb)
  `;
  return projectId;
}

/**
 * A published_games row. `flaggedAt` non-null means the game is under a
 * moderation hold — the state an auto-hide or an admin takedown leaves behind.
 */
async function seedPublication(opts: {
  ownerId: string;
  projectId: string;
  slug: string;
  status?: string;
  flagged?: boolean;
}): Promise<string> {
  const gameId = randomUUID();
  await harness().neonSql`
    INSERT INTO published_games
      (id, user_id, project_id, slug, title, status, flagged_at, report_count)
    VALUES (
      ${gameId}::uuid, ${opts.ownerId}::uuid, ${opts.projectId}::uuid,
      ${opts.slug}, 'Test Game', ${opts.status ?? 'flagged'}::publish_status,
      ${opts.flagged === false ? null : '2026-05-01T00:00:00.000Z'},
      ${opts.flagged === false ? 0 : 3}
    )
  `;
  return gameId;
}

async function publicationRows(ownerId: string): Promise<QueryRow[]> {
  return harness().neonSql`
    SELECT id, slug, status, flagged_at, project_id
    FROM published_games WHERE user_id = ${ownerId}::uuid ORDER BY slug
  `;
}

function validBody(over: Record<string, unknown> = {}) {
  return {
    projectId: randomUUID(),
    title: 'My Awesome Game',
    slug: 'my-awesome-game',
    description: 'A description of the game',
    tags: ['platformer'],
    ...over,
  };
}

describe('POST /api/publish — moderation hold against real Postgres', () => {
  beforeAll(async () => {
    harnessRef.current = await createTestHarness();
  });

  afterAll(async () => {
    await harnessRef.current?.close();
  });

  beforeEach(async () => {
    await harness().truncateAll();
  });

  it('refuses a republish of a held project under a BRAND NEW slug, and writes nothing', async () => {
    // The bypass, end to end: the creator's game was taken down (status
    // 'flagged', flagged_at set) under `original-slug`. They re-POST the same
    // projectId with a slug that has never existed.
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);
    await seedPublication({ ownerId: owner.id, projectId, slug: 'original-slug' });

    const res = await publish(owner, validBody({ projectId, slug: 'a-brand-new-slug' }));

    expect(res.status).toBe(403);
    expect(res.json.code).toBe('MODERATION_HOLD');

    // The decisive assertion: no second row exists, and the held one is
    // untouched. A 403 with a fresh 'published' row alongside it would be the
    // bug wearing the fix's response body.
    const rows = await publicationRows(owner.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].slug).toBe('original-slug');
    expect(rows[0].status).toBe('flagged');
    expect(rows[0].flagged_at).not.toBeNull();
  });

  it('refuses a republish of a held game under its own slug', async () => {
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);
    await seedPublication({ ownerId: owner.id, projectId, slug: 'held-slug' });

    const res = await publish(owner, validBody({ projectId, slug: 'held-slug' }));

    expect(res.status).toBe(403);
    expect(res.json.code).toBe('MODERATION_HOLD');

    const rows = await publicationRows(owner.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('flagged');
  });

  it('still refuses when the creator unpublished the held game first', async () => {
    // DELETE /api/publish/[id] moves the row to 'unpublished' but leaves
    // flagged_at set. Gating on status instead of flagged_at would make that
    // two-call sequence a working bypass.
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);
    await seedPublication({
      ownerId: owner.id,
      projectId,
      slug: 'held-slug',
      status: 'unpublished',
    });

    const res = await publish(owner, validBody({ projectId, slug: 'a-fresh-slug' }));

    expect(res.status).toBe(403);
    expect(res.json.code).toBe('MODERATION_HOLD');
    expect(await publicationRows(owner.id)).toHaveLength(1);
  });

  it('lets an unheld project publish under a new slug (the predicate does not over-block)', async () => {
    // Same shape as the bypass case with the hold removed. Without this, a
    // predicate that blocked every republish would pass every test above.
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);
    await seedPublication({
      ownerId: owner.id,
      projectId,
      slug: 'original-slug',
      status: 'published',
      flagged: false,
    });

    const res = await publish(owner, validBody({ projectId, slug: 'a-brand-new-slug' }));

    expect(res.status).toBe(200);
    expect(res.json.publication?.slug).toBe('a-brand-new-slug');
    expect(res.json.publication?.status).toBe('published');

    const rows = await publicationRows(owner.id);
    expect(rows.map((r) => r.slug)).toEqual(['a-brand-new-slug', 'original-slug']);
  });

  it("another creator's held game does not block this creator", async () => {
    // The predicate is `user_id = me AND (...)`. Dropping the user scope would
    // let any takedown anywhere freeze an unrelated account. The collision has
    // to be on the SLUG to be reachable: uq_published_games_slug is on
    // (user_id, slug), so two creators can legitimately hold the same slug,
    // while project ids never collide across users.
    const other = await seedUser(harness().neonSql, { tier: 'creator' });
    const otherProject = await seedProject(other.id);
    await seedPublication({ ownerId: other.id, projectId: otherProject, slug: 'shared-slug' });

    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);

    const res = await publish(owner, validBody({ projectId, slug: 'shared-slug' }));

    expect(res.status).toBe(200);
    expect(res.json.publication?.status).toBe('published');
  });

  it('a hold on a DIFFERENT project of the same creator does not block this one', async () => {
    // The hold is project-scoped on purpose: one takedown must not turn into
    // an account-wide publishing ban.
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const heldProject = await seedProject(owner.id);
    await seedPublication({ ownerId: owner.id, projectId: heldProject, slug: 'held-slug' });

    const cleanProject = await seedProject(owner.id);
    const res = await publish(owner, validBody({ projectId: cleanProject, slug: 'clean-slug' }));

    expect(res.status).toBe(200);
    expect(res.json.publication?.status).toBe('published');

    const rows = await publicationRows(owner.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.slug === 'held-slug')?.status).toBe('flagged');
  });

  it('a non-uuid projectId still gets the slug-scoped hold', async () => {
    // publishSchema accepts any 1-100 char string for projectId, and
    // published_games.project_id is a uuid column, so the project arm is
    // skipped for legacy callers rather than raising 22P02. The slug arm must
    // still fire — this is the case that proves the uuid guard did not
    // disable the gate outright.
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);
    await seedPublication({ ownerId: owner.id, projectId, slug: 'held-slug' });

    const res = await publish(owner, validBody({ projectId: 'proj-1', slug: 'held-slug' }));

    expect(res.status).toBe(403);
    expect(res.json.code).toBe('MODERATION_HOLD');
  });

  /**
   * The tier limit and the moderation hold are two gates on the same statement,
   * and the hold introduced a status the limit had never had to think about.
   *
   * `PUBLISH_LIMITS.starter` is 1, so the free tier is where both edges of the
   * counter are reachable in a single row — which is exactly why the counting
   * predicate belongs in a real-Postgres test rather than the sibling mock
   * suite, whose `.where()` is a passthrough that returns the same rows no
   * matter what the query asks for.
   */
  describe('tier publish limit vs. the moderation hold', () => {
    it('counts a game under a moderation hold against the tier limit', async () => {
      // Auto-hide flips 'published' -> 'flagged'. Counting only 'published'
      // freed the creator's single starter slot the moment their game was
      // hidden, so they published a replacement — and an admin approve (or a
      // won appeal) then put the hidden game back to 'published', leaving the
      // account permanently at 2 games on a 1-game tier with no path back
      // under the limit. A hold is not a slot the creator gave up.
      const owner = await seedUser(harness().neonSql); // starter: limit 1
      const heldProject = await seedProject(owner.id);
      await seedPublication({ ownerId: owner.id, projectId: heldProject, slug: 'held-slug' });

      const freshProject = await seedProject(owner.id);
      const res = await publish(
        owner,
        validBody({ projectId: freshProject, slug: 'replacement-slug' })
      );

      expect(res.status).toBe(403);
      expect(res.json.error).toContain('Publish limit reached');

      // The 403 has to mean nothing was written. A refusal alongside a fresh
      // 'published' row is the bug wearing the fix's response body.
      const rows = await publicationRows(owner.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].slug).toBe('held-slug');
      expect(rows[0].status).toBe('flagged');
    });

    it('does not count a game the creator unpublished themselves', async () => {
      // The other edge: 'unpublished' IS a slot the creator gave up, so it must
      // stay free. Without this case a counter that simply counted every row
      // would pass the test above.
      const owner = await seedUser(harness().neonSql); // starter: limit 1
      const retiredProject = await seedProject(owner.id);
      await seedPublication({
        ownerId: owner.id,
        projectId: retiredProject,
        slug: 'retired-slug',
        status: 'unpublished',
        flagged: false,
      });

      const freshProject = await seedProject(owner.id);
      const res = await publish(
        owner,
        validBody({ projectId: freshProject, slug: 'a-new-slug' })
      );

      expect(res.status).toBe(200);
      expect(res.json.publication?.status).toBe('published');
    });

    it('lets a creator at their tier limit republish a game they already own', async () => {
      // The limit gates how many games exist, not how many times one is
      // updated. Counting the target row against its own republish made the
      // starter tier's single publication permanently un-updatable: every
      // re-POST of the only slug the account owns saw 1 >= 1 and 403'd.
      const owner = await seedUser(harness().neonSql); // starter: limit 1
      const projectId = await seedProject(owner.id);
      await seedPublication({
        ownerId: owner.id,
        projectId,
        slug: 'only-slug',
        status: 'published',
        flagged: false,
      });

      const res = await publish(owner, validBody({ projectId, slug: 'only-slug' }));

      expect(res.status).toBe(200);
      expect(res.json.publication?.version).toBe(2);

      const rows = await publicationRows(owner.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('published');
    });
  });
});
