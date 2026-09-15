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

const databaseFaults = vi.hoisted(() => ({
  loseNextCommitResponse: false,
  failReferenceCheck: false,
  awaitingReferenceCheck: false,
  referenceCheckCount: 0,
}));

vi.mock('@/lib/db/client', () => ({
  getDb: () => harness().db,
  getNeonSql: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    // Execute the real atomic SQL first. Losing the response must not undo the
    // committed row, snapshot, or tags as a pre-write rejection mock would.
    const rows = await harness().neonSql(strings, ...values);
    if (databaseFaults.loseNextCommitResponse) {
      databaseFaults.loseNextCommitResponse = false;
      databaseFaults.awaitingReferenceCheck = true;
      throw new Error('Database commit response lost');
    }
    return rows;
  },
  queryWithResilience: (fn: () => Promise<unknown>) => {
    if (databaseFaults.awaitingReferenceCheck) {
      databaseFaults.awaitingReferenceCheck = false;
      databaseFaults.referenceCheckCount += 1;
      if (databaseFaults.failReferenceCheck) {
        throw new Error('Bundle reference lookup unavailable');
      }
    }
    return fn();
  },
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
const deleteBundleSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/storage/publishedGameStorage', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/storage/publishedGameStorage')>(),
  deletePublishedGameBundle: (...args: unknown[]) => deleteBundleSpy(...args),
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

describe('POST /api/publish — private snapshots against real Postgres', () => {
  beforeAll(async () => {
    harnessRef.current = await createTestHarness();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await harnessRef.current?.close();
  });
  beforeEach(async () => {
    await harness().truncateAll();
    writeBundleSpy.mockReset();
    deleteBundleSpy.mockReset();
    captureExceptionSpy.mockReset();
    databaseFaults.loseNextCommitResponse = false;
    databaseFaults.failReferenceCheck = false;
    databaseFaults.awaitingReferenceCheck = false;
    databaseFaults.referenceCheckCount = 0;
    vi.stubEnv('PUBLISH_TO_R2', 'true');
    writeBundleSpy.mockImplementation(async (userId: string, slug: string) => ({
      key: `games/${userId}/${slug}/${randomUUID()}/bundle.json`,
    }));
  });

  async function stored(ownerId: string): Promise<QueryRow[]> {
    return harness().neonSql`
      SELECT slug, version, title, cdn_url, cdn_bundle_key, published_scene_data
      FROM published_games WHERE user_id = ${ownerId}::uuid ORDER BY slug
    `;
  }

  it('persists an immutable key and identical Postgres snapshot while retaining the /play share URL', async () => {
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);
    const scene = { entities: [{ id: 'published' }] };
    await harness().neonSql`UPDATE projects SET scene_data = ${JSON.stringify(scene)}::jsonb WHERE id = ${projectId}::uuid`;

    const res = await publish(owner, validBody({ projectId }));
    expect(res.status).toBe(200);
    const [row] = await stored(owner.id);
    expect(row.cdn_url).toBe(`/play/${owner.clerkId}/my-awesome-game`);
    expect(row.cdn_bundle_key).toMatch(/\/bundle\.json$/);
    expect(row.published_scene_data).toEqual(scene);
    expect(writeBundleSpy.mock.calls[0]).toEqual([
      owner.clerkId, 'my-awesome-game', scene,
      expect.objectContaining({ schemaVersion: 1, version: 1, userId: owner.clerkId, slug: 'my-awesome-game' }),
    ]);
    // The publish response contains neither the raw snapshot nor a private key.
    expect(res.json.publication).not.toHaveProperty('publishedSceneData');
    expect(res.json.publication).not.toHaveProperty('cdnBundleKey');
  });

  it.each(['off', 'failed'])('retains a publication snapshot with storage %s', async (mode) => {
    if (mode === 'off') vi.stubEnv('PUBLISH_TO_R2', 'false');
    else writeBundleSpy.mockRejectedValue(new Error('R2 unavailable'));
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);
    const res = await publish(owner, validBody({ projectId }));
    expect(res.status).toBe(200);
    const [row] = await stored(owner.id);
    expect(row.cdn_bundle_key).toBeNull();
    expect(row.published_scene_data).toEqual({});
    expect(row.cdn_url).toBe(`/play/${owner.clerkId}/my-awesome-game`);
    if (mode === 'off') expect(writeBundleSpy).not.toHaveBeenCalled();
    else expect(captureExceptionSpy).toHaveBeenCalled();
  });

  it('only cleans up the prior object after a successful replacement commits', async () => {
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);
    await publish(owner, validBody({ projectId, tags: ['old'] }));
    const [previous] = await stored(owner.id);
    deleteBundleSpy.mockClear();
    deleteBundleSpy.mockImplementation(async (key: string) => {
      expect((await stored(owner.id))[0].cdn_bundle_key).not.toBe(key);
    });
    const res = await publish(owner, validBody({ projectId, tags: ['new', 'new'] }));
    expect(res.status).toBe(200);
    expect(res.json.publication?.version).toBe(2);
    expect(deleteBundleSpy).toHaveBeenCalledWith(previous.cdn_bundle_key, owner.clerkId, 'my-awesome-game');
    const tags = await harness().neonSql`SELECT tag FROM game_tags`;
    expect(tags).toEqual([{ tag: 'new' }]);
  });

  it('rolls back the publication and deletes only its candidate object if tag replacement fails', async () => {
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);
    await publish(owner, validBody({ projectId, tags: ['old'] }));
    const [previous] = await stored(owner.id);
    deleteBundleSpy.mockClear();
    await harness().neonSql`
      CREATE FUNCTION reject_review_tag() RETURNS trigger AS $$
      BEGIN IF NEW.tag = 'reject-this' THEN RAISE EXCEPTION 'tag write failed'; END IF; RETURN NEW; END;
      $$ LANGUAGE plpgsql
    `;
    await harness().neonSql`CREATE TRIGGER review_tag BEFORE INSERT ON game_tags FOR EACH ROW EXECUTE FUNCTION reject_review_tag()`;
    try {
      const res = await publish(owner, validBody({ projectId, title: 'Failed revision', tags: ['reject-this'] }));
      expect(res.status).toBe(500);
      expect((await stored(owner.id))[0]).toEqual(previous);
      expect(await harness().neonSql`SELECT tag FROM game_tags`).toEqual([{ tag: 'old' }]);
      const cleanupKey = deleteBundleSpy.mock.calls[0][0];
      expect(cleanupKey).not.toBe(previous.cdn_bundle_key);
      expect(deleteBundleSpy).toHaveBeenCalledTimes(1);
    } finally {
      await harness().neonSql`DROP TRIGGER review_tag ON game_tags`;
      await harness().neonSql`DROP FUNCTION reject_review_tag()`;
    }
  });

  it('retains the committed bundle when its database response is lost', async () => {
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);
    const candidateKey = `games/${owner.clerkId}/my-awesome-game/${randomUUID()}/bundle.json`;
    const scene = { entities: [{ id: 'committed-scene' }] };
    await harness().neonSql`UPDATE projects SET scene_data = ${JSON.stringify(scene)}::jsonb WHERE id = ${projectId}::uuid`;
    writeBundleSpy.mockResolvedValueOnce({ key: candidateKey });
    databaseFaults.loseNextCommitResponse = true;

    const res = await publish(owner, validBody({ projectId, title: 'Committed revision', tags: ['committed'] }));

    expect(res.status).toBe(500);
    expect(await stored(owner.id)).toEqual([
      expect.objectContaining({
        version: 1, title: 'Committed revision',
        cdn_bundle_key: candidateKey, published_scene_data: scene,
      }),
    ]);
    expect(await harness().neonSql`SELECT tag FROM game_tags`).toEqual([{ tag: 'committed' }]);
    expect(databaseFaults.referenceCheckCount).toBe(1);
    expect(deleteBundleSpy).not.toHaveBeenCalled();
    expect(captureExceptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Database commit response lost' }),
      expect.objectContaining({ route: '/api/publish', method: 'POST' }),
    );
    expect(captureExceptionSpy).not.toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ stage: 'r2-rollback-check' }),
    );
  });

  it('retains the candidate and reports a failed reference check after a lost commit response', async () => {
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);
    const initial = await publish(owner, validBody({ projectId, tags: ['previous'] }));
    expect(initial.status).toBe(200);
    const [previous] = await stored(owner.id);
    deleteBundleSpy.mockClear();
    const candidateKey = `games/${owner.clerkId}/my-awesome-game/${randomUUID()}/bundle.json`;
    writeBundleSpy.mockResolvedValueOnce({ key: candidateKey });
    databaseFaults.loseNextCommitResponse = true;
    databaseFaults.failReferenceCheck = true;

    const res = await publish(owner, validBody({ projectId, title: 'Committed replacement', tags: ['replacement'] }));

    expect(res.status).toBe(500);
    expect(await stored(owner.id)).toEqual([
      expect.objectContaining({
        version: 2, title: 'Committed replacement',
        cdn_bundle_key: candidateKey, published_scene_data: {},
      }),
    ]);
    expect(candidateKey).not.toBe(previous.cdn_bundle_key);
    expect(await harness().neonSql`SELECT tag FROM game_tags`).toEqual([{ tag: 'replacement' }]);
    expect(databaseFaults.referenceCheckCount).toBe(1);
    expect(deleteBundleSpy).not.toHaveBeenCalled();
    expect(captureExceptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Bundle reference lookup unavailable' }),
      { route: '/api/publish', stage: 'r2-rollback-check', key: candidateKey },
    );
    expect(captureExceptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Database commit response lost' }),
      expect.objectContaining({ route: '/api/publish', method: 'POST' }),
    );
  });

  it.each([false, true])('keeps the winning bundle, version and tags during concurrent publish (existing=%s)', async (existing) => {
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);
    if (existing) await publish(owner, validBody({ projectId }));
    deleteBundleSpy.mockClear();
    let release: (value: { key: string }) => void = () => {};
    let started: () => void = () => {};
    const waiting = new Promise<void>((resolve) => { started = resolve; });
    const losingKey = `games/${owner.clerkId}/my-awesome-game/${randomUUID()}/bundle.json`;
    writeBundleSpy.mockImplementationOnce(() => {
      started();
      return new Promise<{ key: string }>((resolve) => { release = resolve; });
    });
    const losing = publish(owner, validBody({ projectId, title: 'Losing revision', tags: ['loser'] }));
    await waiting;
    const winner = await publish(owner, validBody({ projectId, title: 'Winning revision', tags: ['winner'] }));
    expect(winner.status).toBe(200);
    const [winningRow] = await stored(owner.id);
    release({ key: losingKey });
    expect((await losing).status).toBe(409);
    expect((await stored(owner.id))[0]).toEqual(winningRow);
    expect(winningRow.version).toBe(existing ? 2 : 1);
    expect(winningRow.title).toBe('Winning revision');
    expect(await harness().neonSql`SELECT tag FROM game_tags`).toEqual([{ tag: 'winner' }]);
    expect(deleteBundleSpy).toHaveBeenCalledWith(losingKey, owner.clerkId, 'my-awesome-game');
    expect(deleteBundleSpy).not.toHaveBeenCalledWith(winningRow.cdn_bundle_key, owner.clerkId, 'my-awesome-game');
  });

  it('keeps the publication snapshot unchanged after a later editor save', async () => {
    const owner = await seedUser(harness().neonSql, { tier: 'creator' });
    const projectId = await seedProject(owner.id);
    await publish(owner, validBody({ projectId }));
    await harness().neonSql`UPDATE projects SET scene_data = '{"secretDraft":true}'::jsonb WHERE id = ${projectId}::uuid`;
    expect((await stored(owner.id))[0].published_scene_data).toEqual({});
  });
});
