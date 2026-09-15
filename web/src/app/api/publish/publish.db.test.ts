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

// queryWithResilience is a passthrough by default. `qwr.impl` is swappable so a
// single test can hook the wrapped queries — used below to reproduce the
// concurrent-publish TOCTOU race deterministically (inject a conflicting row
// immediately before the route's INSERT, forcing the onConflictDoUpdate arm).
const qwr = vi.hoisted(() => ({
  impl: (fn: () => Promise<unknown>) => fn(),
  reset() {
    this.impl = (fn: () => Promise<unknown>) => fn();
  },
}));
vi.mock('@/lib/db/client', () => ({
  getDb: () => harness().db,
  getNeonSql: () => harness().neonSql,
  queryWithResilience: (fn: () => Promise<unknown>) => qwr.impl(fn),
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

const captureExceptionSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: captureExceptionSpy }));

// The R2 transport is mocked at the storage-module boundary so these tests
// exercise the publish route's mirror wiring (key/manifest passed, row columns
// written, fail-open) against real Postgres, with no network. The existing
// moderation-hold suite below never triggers it — PUBLISH_TO_R2 is unset there
// and defaults off without an ASSET_BUCKET_NAME.
const writeBundleSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/storage/publishedGameStorage', () => ({
  writePublishedGameBundle: (...args: unknown[]) => writeBundleSpy(...args),
  readPublishedGameBundle: vi.fn(),
}));

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

/**
 * R2 bundle mirroring on publish (#7580).
 *
 * Proves the actual COLUMN STATE the publish route writes — the sibling mock
 * suite's `.where()` is a passthrough that cannot see stored values, the same
 * reason the moderation-hold proof lives here (see this file's header). The R2
 * transport is mocked at the storage-module boundary so no network is touched;
 * the assertions are on the row and on the arguments the route hands the mirror.
 */
describe('POST /api/publish — R2 bundle mirroring against real Postgres', () => {
  beforeAll(async () => {
    harnessRef.current = await createTestHarness();
  });

  afterAll(async () => {
    await harnessRef.current?.close();
  });

  beforeEach(async () => {
    await harness().truncateAll();
    writeBundleSpy.mockReset();
    captureExceptionSpy.mockReset();
    qwr.reset();
    delete process.env.PUBLISH_TO_R2;
  });

  afterAll(() => {
    qwr.reset();
    delete process.env.PUBLISH_TO_R2;
  });

  async function cdnColumns(ownerId: string): Promise<QueryRow[]> {
    return harness().neonSql`
      SELECT slug, cdn_url, cdn_bundle_key
      FROM published_games WHERE user_id = ${ownerId}::uuid ORDER BY slug
    `;
  }

  it('mirrors the bundle and stores its R2 key, keeping cdn_url at /play, when enabled', async () => {
    process.env.PUBLISH_TO_R2 = 'true';
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);

    const key = `games/${owner.clerkId}/my-awesome-game/bundle.json`;
    const url = `https://cdn.test/${key}`;
    writeBundleSpy.mockResolvedValue({ key, url });

    const res = await publish(owner, validBody({ projectId, slug: 'my-awesome-game' }));

    expect(res.status).toBe(200);
    expect(res.json.publication?.status).toBe('published');

    // The route passed the creator's clerkId, the slug, the scene data and a
    // manifest carrying the version/slug/userId — not an adjacent shape.
    expect(writeBundleSpy).toHaveBeenCalledTimes(1);
    const [userIdArg, slugArg, , manifestArg] = writeBundleSpy.mock.calls[0] as [
      string,
      string,
      unknown,
      { version: number; slug: string; userId: string; publishedAt: string },
    ];
    expect(userIdArg).toBe(owner.clerkId);
    expect(slugArg).toBe('my-awesome-game');
    expect(manifestArg).toMatchObject({
      version: 1,
      slug: 'my-awesome-game',
      userId: owner.clerkId,
    });
    expect(typeof manifestArg.publishedAt).toBe('string');

    // The decisive assertion: the object key is persisted, and cdn_url STAYS the
    // stable /play route — never the raw R2 bundle url. Every cdn_url consumer
    // (community gallery Play button + share link, publish/list) resolves it as
    // the playable page (#7580 review); repointing it at the JSON object would
    // send players at a raw file.
    const rows = await cdnColumns(owner.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].cdn_bundle_key).toBe(key);
    expect(rows[0].cdn_url).toBe(`/play/${owner.clerkId}/my-awesome-game`);
  });

  it('stamps the DB-assigned version onto the manifest when the insert resolves via onConflictDoUpdate', async () => {
    // Item 1 (#7580 review): the create branch used to mirror with a hardcoded
    // manifest.version of 1. On the concurrent-publish race PF-212's
    // onConflictDoUpdate exists for — a competing request inserts the row after
    // this request's existence SELECTs saw nothing but before its own INSERT —
    // the DB stamps `version + 1`, so a hardcoded 1 diverged from the persisted
    // row. The fix persists first, then mirrors with the version the row
    // actually carries.
    process.env.PUBLISH_TO_R2 = 'true';
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);

    const key = `games/${owner.clerkId}/raced/bundle.json`;
    writeBundleSpy.mockResolvedValue({ key, url: `https://cdn.test/${key}` });

    // Reproduce the race deterministically: the create branch issues three
    // wrapped queries before its INSERT (two existence SELECTs, then the project
    // SELECT). Inject a conflicting row (already at version 4) just before the
    // 4th wrapped query — the INSERT — so it lands on the ON CONFLICT DO UPDATE
    // arm and the DB stamps version 5.
    let wrapped = 0;
    let injected = false;
    qwr.impl = async (fn: () => Promise<unknown>) => {
      wrapped += 1;
      if (!injected && wrapped === 4) {
        injected = true;
        await harness().neonSql`
          INSERT INTO published_games
            (id, user_id, project_id, slug, title, status, version)
          VALUES (${randomUUID()}::uuid, ${owner.id}::uuid, ${projectId}::uuid,
                  'raced', 'Racer', 'published'::publish_status, 4)
        `;
      }
      return fn();
    };

    const res = await publish(owner, validBody({ projectId, slug: 'raced' }));

    expect(injected).toBe(true);
    expect(res.status).toBe(200);
    // The row was updated, not duplicated, and the DB stamped 4 + 1.
    expect(res.json.publication?.version).toBe(5);

    // The decisive assertion: the manifest version handed to the mirror matches
    // the version the row actually carries — not a hardcoded 1.
    expect(writeBundleSpy).toHaveBeenCalledTimes(1);
    const manifestArg = writeBundleSpy.mock.calls[0][3] as { version: number };
    expect(manifestArg.version).toBe(5);

    const rows = await cdnColumns(owner.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].cdn_bundle_key).toBe(key);
    expect(rows[0].cdn_url).toBe(`/play/${owner.clerkId}/raced`);
  });

  it('keeps cdn_url at /play and cdn_bundle_key NULL when PUBLISH_TO_R2 is off', async () => {
    process.env.PUBLISH_TO_R2 = 'false';
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);

    const res = await publish(owner, validBody({ projectId, slug: 'no-mirror' }));

    expect(res.status).toBe(200);
    expect(writeBundleSpy).not.toHaveBeenCalled();

    const rows = await cdnColumns(owner.id);
    expect(rows[0].cdn_url).toBe(`/play/${owner.clerkId}/no-mirror`);
    expect(rows[0].cdn_bundle_key).toBeNull();
  });

  it('publishes fail-open when the mirror throws: 200, key NULL, /play url, Sentry logged', async () => {
    process.env.PUBLISH_TO_R2 = 'true';
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);
    writeBundleSpy.mockRejectedValue(new Error('R2 unavailable'));

    const res = await publish(owner, validBody({ projectId, slug: 'r2-down' }));

    // R2 availability must never block a publish.
    expect(res.status).toBe(200);
    expect(res.json.publication?.status).toBe('published');
    expect(captureExceptionSpy).toHaveBeenCalled();

    const rows = await cdnColumns(owner.id);
    expect(rows[0].cdn_bundle_key).toBeNull();
    expect(rows[0].cdn_url).toBe(`/play/${owner.clerkId}/r2-down`);
  });

  it('clears a stale bundle key when a republish mirror fails', async () => {
    // A republish whose mirror fails must not leave /play pointed at the
    // previous version's bundle — the key drops back to NULL so /play serves
    // fresh Postgres scene data.
    process.env.PUBLISH_TO_R2 = 'true';
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);

    const key = `games/${owner.clerkId}/again/bundle.json`;
    writeBundleSpy.mockResolvedValueOnce({ key, url: `https://cdn.test/${key}` });
    const first = await publish(owner, validBody({ projectId, slug: 'again' }));
    expect(first.status).toBe(200);
    expect((await cdnColumns(owner.id))[0].cdn_bundle_key).toBe(key);

    writeBundleSpy.mockRejectedValueOnce(new Error('R2 unavailable'));
    const second = await publish(owner, validBody({ projectId, slug: 'again' }));
    expect(second.status).toBe(200);
    expect(second.json.publication?.version).toBe(2);

    const rows = await cdnColumns(owner.id);
    expect(rows[0].cdn_bundle_key).toBeNull();
    expect(rows[0].cdn_url).toBe(`/play/${owner.clerkId}/again`);
  });
});
