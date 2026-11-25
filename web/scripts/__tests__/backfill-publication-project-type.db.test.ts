// @vitest-environment node
/**
 * The #10368 publication-snapshot backfill, against REAL Postgres (PGlite, the
 * schema replayed from web/drizzle/*.sql). The script's whole contract lives in
 * SQL — which rows are candidates, the guarded `jsonb_set`, keyset paging — so
 * these tests assert on row state rather than on the SQL text.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, seedUser, type TestHarness } from '@/lib/db/__tests__/pgliteHarness';
import {
  BACKFILL_REASONS,
  decidePublicationProjectType,
  formatBackfillReport,
  parseBackfillArgs,
  runBackfill,
  writeDecision,
  type SqlTag,
} from '../backfill-publication-project-type';

let harness: TestHarness;
let sql: SqlTag;

beforeAll(async () => {
  harness = await createTestHarness();
  sql = harness.neonSql as unknown as SqlTag;
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.truncateAll();
});

// ── fixtures ────────────────────────────────────────────────────────────────

const sprite = (id: string) => ({ entityId: id, entityType: 'sprite', spriteData: {} });
/** What the game-creation pipeline spawns in a 2D project today: meshes with 3D physics, no 2D marker. */
const pipelinePlane = (id: string) => ({ entityId: id, entityType: 'plane', physicsEnabled: true, physicsData: {} });
const terrain = { entityId: 'land', entityType: 'terrain', terrainData: {} };

function scene(entities: unknown[], projectType?: unknown) {
  const metadata: Record<string, unknown> = { name: 'Game' };
  if (projectType !== undefined) metadata.projectType = projectType;
  return { formatVersion: 3, metadata, entities };
}

interface SeedPublication {
  snapshot: unknown;
  /** The source project's scene; defaults to a key-less one. */
  projectScene?: unknown;
  r2?: boolean;
  version?: number;
}

async function seedPublication(over: SeedPublication): Promise<string> {
  const user = await seedUser(harness.neonSql);
  const projectId = randomUUID();
  const publicationId = randomUUID();
  await harness.neonSql`
    INSERT INTO projects (id, user_id, name, scene_data)
    VALUES (${projectId}, ${user.id}, 'P', ${JSON.stringify(over.projectScene ?? scene([]))}::jsonb)
  `;
  await harness.neonSql`
    INSERT INTO published_games (id, user_id, project_id, slug, title, status, version, published_scene_data, cdn_bundle_key)
    VALUES (
      ${publicationId}, ${user.id}, ${projectId}, ${`slug-${publicationId.slice(0, 8)}`}, 'T', 'published',
      ${over.version ?? 1},
      ${over.snapshot === null ? null : JSON.stringify(over.snapshot)}::jsonb,
      ${over.r2 ? `games/u/s/${publicationId}/bundle.json` : null}
    )
  `;
  return publicationId;
}

async function storedSnapshot(publicationId: string): Promise<unknown> {
  const rows = await harness.neonSql`SELECT published_scene_data FROM published_games WHERE id = ${publicationId}`;
  return rows[0]?.published_scene_data;
}

async function storedRow(publicationId: string) {
  const rows = await harness.neonSql`SELECT version, updated_at, published_scene_data FROM published_games WHERE id = ${publicationId}`;
  return rows[0];
}

const DRY = { apply: false, batchSize: 50, list: false };
const APPLY = { ...DRY, apply: true };

// ── decision rule ───────────────────────────────────────────────────────────

describe('decidePublicationProjectType', () => {
  it("takes the project's stated type for a pipeline-made 2D game that carries no 2D marker", () => {
    expect(decidePublicationProjectType(scene([pipelinePlane('player'), pipelinePlane('coin')]), '2d')).toEqual({
      projectType: '2d',
      reason: 'project-states-type',
    });
    expect(decidePublicationProjectType(scene([terrain]), '3d')).toEqual({ projectType: '3d', reason: 'project-states-type' });
  });

  it('refuses a stated 2d that the snapshot contradicts with 3D-only content', () => {
    expect(decidePublicationProjectType(scene([sprite('a'), terrain]), '2d')).toEqual({
      projectType: null,
      reason: 'project-2d-but-snapshot-has-3d-content',
    });
  });

  it('refuses a stated 3d whose snapshot the classifier reads as 2D', () => {
    expect(decidePublicationProjectType(scene([sprite('a')]), '3d')).toEqual({
      projectType: null,
      reason: 'project-3d-but-snapshot-reads-2d',
    });
  });

  it('falls back to the classifier only when the project states nothing it can use', () => {
    for (const stated of [undefined, null, '2D', 'ThreeD', 3]) {
      expect(decidePublicationProjectType(scene([sprite('a')]), stated)).toEqual({ projectType: '2d', reason: 'classifier-2d' });
      expect(decidePublicationProjectType(scene([pipelinePlane('a')]), stated)).toEqual({ projectType: null, reason: 'undecided' });
    }
  });

  it.each([[null], ['scene'], [[]], [{ entities: [] }], [{ metadata: {}, entities: 'x' }]])(
    'reports a malformed snapshot %# as malformed, never decided',
    (snapshot) => {
      expect(decidePublicationProjectType(snapshot, '2d')).toEqual({ projectType: null, reason: 'malformed-snapshot' });
    },
  );
});

describe('parseBackfillArgs', () => {
  it('is a dry run unless --apply is passed', () => {
    expect(parseBackfillArgs([])).toEqual({ apply: false, batchSize: 50, list: false });
    expect(parseBackfillArgs(['--apply', '--list', '--batch-size=7'])).toEqual({ apply: true, batchSize: 7, list: true });
  });

  it.each([['--aply'], ['apply'], ['--batch-size=0'], ['--batch-size=501'], ['--batch-size=2.5']])('refuses %s', (arg) => {
    expect(() => parseBackfillArgs([arg])).toThrow();
  });
});

// ── against Postgres ────────────────────────────────────────────────────────

describe('runBackfill (real Postgres)', () => {
  async function seedMixedTable() {
    return {
      pipeline2d: await seedPublication({ snapshot: scene([pipelinePlane('p')]), projectScene: scene([], '2d'), r2: true }),
      sprites: await seedPublication({ snapshot: scene([sprite('s')]) }),
      ambiguous: await seedPublication({ snapshot: scene([pipelinePlane('p')]) }),
      contradicted: await seedPublication({ snapshot: scene([sprite('s'), terrain]), projectScene: scene([], '2d') }),
      stated3d: await seedPublication({ snapshot: scene([sprite('s')], '3d'), projectScene: scene([], '2d') }),
      nullKey: await seedPublication({ snapshot: scene([terrain], null), projectScene: scene([], '3d') }),
      noSnapshot: await seedPublication({ snapshot: null, projectScene: scene([sprite('s')]) }),
      malformed: await seedPublication({ snapshot: { metadata: {}, entities: 'no' } }),
    };
  }

  it('dry run counts every decision and reason and writes nothing', async () => {
    const ids = await seedMixedTable();
    const before = await Promise.all(Object.values(ids).map(storedSnapshot));

    const report = await runBackfill(sql, DRY);

    expect(report).toMatchObject({
      apply: false,
      totalPublications: 8,
      alreadyStated: 1,
      noSnapshot: 1,
      candidates: 6,
      byDecision: { '2d': 2, '3d': 1, unstated: 3 },
      byReason: {
        'project-states-type': 2,
        'classifier-2d': 1,
        'project-2d-but-snapshot-has-3d-content': 1,
        'project-3d-but-snapshot-reads-2d': 0,
        undecided: 1,
        'malformed-snapshot': 1,
      },
      decidedWithR2Mirror: 1,
      written: 0,
      skippedChangedSinceRead: 0,
    });
    expect(report.results.every((r) => r.written === undefined)).toBe(true);
    expect(await Promise.all(Object.values(ids).map(storedSnapshot))).toEqual(before);
  });

  it('--apply writes only the decided key, keeps the rest of the snapshot, and never replaces a value', async () => {
    const ids = await seedMixedTable();
    const pipelineBefore = await storedRow(ids.pipeline2d);

    const report = await runBackfill(sql, APPLY);

    expect(report.written).toBe(3);
    expect(report.skippedChangedSinceRead).toBe(0);
    expect(await storedSnapshot(ids.pipeline2d)).toEqual(scene([pipelinePlane('p')], '2d'));
    expect(await storedSnapshot(ids.sprites)).toEqual(scene([sprite('s')], '2d'));
    // An explicit JSON null is absence, the same as the engine reads it.
    expect(await storedSnapshot(ids.nullKey)).toEqual(scene([terrain], '3d'));
    // Left exactly as they were.
    expect(await storedSnapshot(ids.ambiguous)).toEqual(scene([pipelinePlane('p')]));
    expect(await storedSnapshot(ids.contradicted)).toEqual(scene([sprite('s'), terrain]));
    expect(await storedSnapshot(ids.stated3d)).toEqual(scene([sprite('s')], '3d'));
    expect(await storedSnapshot(ids.noSnapshot)).toBeNull();
    expect(await storedSnapshot(ids.malformed)).toEqual({ metadata: {}, entities: 'no' });
    // Neither the revision nor the timestamp moves: this is a metadata repair.
    const pipelineAfter = await storedRow(ids.pipeline2d);
    expect(pipelineAfter?.version).toBe(pipelineBefore?.version);
    expect(pipelineAfter?.updated_at).toEqual(pipelineBefore?.updated_at);
  });

  it('is idempotent: a second --apply has no candidates it can decide and writes nothing', async () => {
    await seedMixedTable();
    await runBackfill(sql, APPLY);

    const second = await runBackfill(sql, APPLY);

    expect(second.written).toBe(0);
    expect(second.alreadyStated).toBe(4);
    expect(second.byDecision).toEqual({ '2d': 0, '3d': 0, unstated: 3 });
  });

  it('pages through every candidate when the table is larger than one batch', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 7; i += 1) ids.push(await seedPublication({ snapshot: scene([sprite(`s${i}`)]) }));

    // Dry run first: nothing leaves the candidate set, so a page that re-reads
    // or skips rows shows up as a wrong count or a duplicate id.
    const dry = await runBackfill(sql, { ...DRY, batchSize: 2 });
    expect(dry.results.map((r) => r.publicationId).sort()).toEqual([...ids].sort());

    const report = await runBackfill(sql, { ...APPLY, batchSize: 2 });

    expect(report.candidates).toBe(7);
    expect(report.written).toBe(7);
    expect(new Set(report.results.map((r) => r.publicationId))).toEqual(new Set(ids));
  });

  it('a guarded write skips a row that was republished (new version) or stated since it was read', async () => {
    const id = await seedPublication({ snapshot: scene([pipelinePlane('p')]), version: 3 });

    expect(await writeDecision(sql, { publicationId: id, version: 2, projectType: '2d' })).toBe(false);
    expect(await storedSnapshot(id)).toEqual(scene([pipelinePlane('p')]));

    expect(await writeDecision(sql, { publicationId: id, version: 3, projectType: '2d' })).toBe(true);
    expect(await writeDecision(sql, { publicationId: id, version: 3, projectType: '3d' })).toBe(false);
    expect(await storedSnapshot(id)).toEqual(scene([pipelinePlane('p')], '2d'));
  });

  it('report text names every reason and carries no slug or title', async () => {
    const id = await seedPublication({ snapshot: scene([sprite('s')]) });
    const text = formatBackfillReport(await runBackfill(sql, DRY), true);

    for (const reason of BACKFILL_REASONS) expect(text).toContain(`  ${reason}: `);
    expect(text).toContain('DRY RUN');
    expect(text).toContain(`${id} 2d classifier-2d`);
    expect(text).not.toContain('slug-');
  });
});
