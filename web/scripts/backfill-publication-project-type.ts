/**
 * Backfill `metadata.projectType` into stored publication snapshots that
 * predate #10358 (#10368).
 *
 * WHY. Since #10358 the engine writes the project's dimension into every scene
 * it exports, and `/play` applies it. A game published before that carries no
 * key, so `/play` leaves the engine at 3D and a 2D game renders blank. #10454's
 * `/play` heuristic (`guessLegacyPublicationProjectType`) rescues the
 * unmistakably-2D ones at runtime, but it cannot see the largest group: a 2D
 * game built by the game-creation pipeline is made of `plane`/`cube` meshes with
 * 3D physics and carries no 2D marker at all. The one record that does know is
 * the SOURCE PROJECT: a project saved since #10358 states its type in its own
 * `scene_data`, so this script copies that statement into the publication.
 *
 * NOT run by any build, deploy, or agent. An operator runs it by hand, dry run
 * first. Runbook: `docs/operations/publication-project-type-backfill.md`.
 *
 * Usage (from web/):
 *   DATABASE_URL=... npx tsx scripts/backfill-publication-project-type.ts            # dry run
 *   DATABASE_URL=... npx tsx scripts/backfill-publication-project-type.ts --apply    # write
 *   ... --list        also print one line per candidate (publication id, decision, reason)
 *   ... --batch-size=N  rows read per query (default 50, 1..500)
 *
 * WHAT IT TOUCHES. Only `published_games.published_scene_data`, and only the
 * one key. It never writes `projects`, never touches `updated_at` or `version`,
 * never rewrites an R2 object, and never replaces a value that is already
 * there: the UPDATE's own WHERE clause re-checks that the key is still absent
 * and that the row's `version` is the one that was read, so a concurrent
 * republish is left alone and a second run writes nothing. A JSON `null` counts
 * as absent, the same as the engine (`Option<ProjectType>`) and
 * `readProjectTypeFromSceneData` read it.
 *
 * HOW IT DECIDES, per publication whose snapshot states no type:
 *   1. The source project's `scene_data.metadata.projectType`, when it is `2d`
 *      or `3d` — unless the snapshot contradicts it (a stated `2d` with 3D-only
 *      content such as terrain or a glTF model, or a stated `3d` whose snapshot
 *      the one-sided classifier reads as 2D), which is reported and skipped.
 *      The contradiction check exists because a project's stated type can be
 *      wrong: #10374 records a key-less project inheriting 2D from the previous
 *      project in the same tab and then saving it.
 *   2. Otherwise the #10454 classifier, which only ever answers `2d`.
 *   3. Otherwise nothing is written (`undecided`) and `/play` keeps today's
 *      behaviour for that game.
 * A publication with NO stored snapshot is not a candidate: `/play` serves its
 * live project, so the project's own key (or the runtime heuristic) already
 * applies and there is nothing in `published_games` to write.
 *
 * Exit codes: 0 done, 1 usage error, 2 tooling or database error.
 */
import { pathToFileURL } from 'node:url';
import { neon } from '@neondatabase/serverless';

import { applyE2eNeonEndpointOverride } from '../src/lib/db/e2eNeonEndpoint.ts';
import {
  guessLegacyPublicationProjectType,
  sceneHasThreeDOnlyContent,
} from '../src/lib/scenes/legacyPublicationProjectType.ts';
import { isSceneProjectType, type SceneProjectType } from '../src/lib/scenes/sceneProjectType.ts';

/** The neon tagged-template surface, narrowed to what this script calls. */
export type SqlTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => PromiseLike<Record<string, unknown>[]>;

/** Why a candidate got the decision it got. Printed as-is in the report. */
export const BACKFILL_REASONS = [
  'project-states-type',
  'classifier-2d',
  'project-2d-but-snapshot-has-3d-content',
  'project-3d-but-snapshot-reads-2d',
  'undecided',
  'malformed-snapshot',
] as const;

export type BackfillReason = (typeof BACKFILL_REASONS)[number];

export interface BackfillDecision {
  /** The value to write, or `null` to leave the publication unstated. */
  projectType: SceneProjectType | null;
  reason: BackfillReason;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Decide what one key-less publication snapshot should state.
 * @param snapshot The publication's stored `published_scene_data` (untrusted).
 * @param projectStated The source project's raw `metadata.projectType`, or
 *   `undefined`/`null` when it states none (anything outside `2d`/`3d` counts as none).
 * @returns The value to write, or `null`, with the reason.
 */
export function decidePublicationProjectType(snapshot: unknown, projectStated: unknown): BackfillDecision {
  if (!isRecord(snapshot) || !isRecord(snapshot.metadata) || !Array.isArray(snapshot.entities)) {
    return { projectType: null, reason: 'malformed-snapshot' };
  }
  // The guess reads only key-less scenes, and a candidate is key-less by construction.
  const guess = guessLegacyPublicationProjectType(snapshot);
  if (isSceneProjectType(projectStated)) {
    if (projectStated === '2d' && sceneHasThreeDOnlyContent(snapshot)) {
      return { projectType: null, reason: 'project-2d-but-snapshot-has-3d-content' };
    }
    if (projectStated === '3d' && guess === '2d') {
      return { projectType: null, reason: 'project-3d-but-snapshot-reads-2d' };
    }
    return { projectType: projectStated, reason: 'project-states-type' };
  }
  if (guess === '2d') return { projectType: '2d', reason: 'classifier-2d' };
  return { projectType: null, reason: 'undecided' };
}

export interface BackfillOptions {
  apply: boolean;
  batchSize: number;
  list: boolean;
}

/**
 * Parse the command line. Unknown flags are refused rather than ignored, so a
 * misspelt `--aply` cannot be mistaken for a run that wrote nothing on purpose.
 * @param argv `process.argv.slice(2)`.
 * @throws On an unknown flag or an out-of-range batch size.
 */
export function parseBackfillArgs(argv: readonly string[]): BackfillOptions {
  const options: BackfillOptions = { apply: false, batchSize: 50, list: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--list') options.list = true;
    else if (arg.startsWith('--batch-size=')) {
      const value = Number(arg.slice('--batch-size='.length));
      if (!Number.isInteger(value) || value < 1 || value > 500) {
        throw new Error(`--batch-size must be an integer from 1 to 500, got "${arg}"`);
      }
      options.batchSize = value;
    } else {
      throw new Error(`Unknown argument "${arg}". Accepted: --apply, --list, --batch-size=N`);
    }
  }
  return options;
}

export interface CandidateResult extends BackfillDecision {
  publicationId: string;
  hasR2Mirror: boolean;
  /** Apply mode only: whether the guarded UPDATE changed the row. */
  written?: boolean;
}

export interface BackfillReport {
  apply: boolean;
  totalPublications: number;
  alreadyStated: number;
  noSnapshot: number;
  candidates: number;
  byDecision: Record<'2d' | '3d' | 'unstated', number>;
  byReason: Record<BackfillReason, number>;
  /** Decided candidates whose row also names an R2 object (see the runbook). */
  decidedWithR2Mirror: number;
  written: number;
  /** Decided candidates the guarded UPDATE no longer matched (changed since read). */
  skippedChangedSinceRead: number;
  results: CandidateResult[];
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Write one decision, guarded so it can never replace a value or race a republish.
 * @returns True when the row was changed.
 */
export async function writeDecision(
  sql: SqlTag,
  row: { publicationId: string; version: number; projectType: SceneProjectType },
): Promise<boolean> {
  const updated = await sql`
    UPDATE published_games
    SET published_scene_data = jsonb_set(
      published_scene_data, '{metadata,projectType}', to_jsonb(${row.projectType}::text), true
    )
    WHERE id = ${row.publicationId}::uuid
      AND version = ${row.version}
      AND jsonb_typeof(published_scene_data -> 'metadata') = 'object'
      AND (
        published_scene_data -> 'metadata' -> 'projectType' IS NULL
        OR published_scene_data -> 'metadata' -> 'projectType' = 'null'::jsonb
      )
    RETURNING id
  `;
  return updated.length === 1;
}

/**
 * Scan every publication, decide each key-less snapshot, and (with `apply`) write.
 * @param sql A neon tagged template (production) or the PGlite adapter (tests).
 */
export async function runBackfill(sql: SqlTag, options: BackfillOptions): Promise<BackfillReport> {
  const [counts] = await sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE published_scene_data IS NULL)::int AS no_snapshot,
      count(*) FILTER (
        WHERE published_scene_data IS NOT NULL
          AND published_scene_data -> 'metadata' -> 'projectType' IS NOT NULL
          AND published_scene_data -> 'metadata' -> 'projectType' <> 'null'::jsonb
      )::int AS already_stated
    FROM published_games
  `;
  const report: BackfillReport = {
    apply: options.apply,
    totalPublications: Number(counts?.total ?? 0),
    noSnapshot: Number(counts?.no_snapshot ?? 0),
    alreadyStated: Number(counts?.already_stated ?? 0),
    candidates: 0,
    byDecision: { '2d': 0, '3d': 0, unstated: 0 },
    byReason: Object.fromEntries(BACKFILL_REASONS.map((r) => [r, 0])) as Record<BackfillReason, number>,
    decidedWithR2Mirror: 0,
    written: 0,
    skippedChangedSinceRead: 0,
    results: [],
  };

  // Keyset pagination on the primary key: each page holds whole scene
  // snapshots, so the scan never loads the table at once, and writes made to
  // earlier pages cannot shift later ones.
  let cursor = NIL_UUID;
  for (;;) {
    const page = await sql`
      SELECT
        pg.id::text AS id,
        pg.version AS version,
        pg.cdn_bundle_key IS NOT NULL AS has_r2_mirror,
        pg.published_scene_data AS snapshot,
        p.scene_data -> 'metadata' -> 'projectType' AS project_stated
      FROM published_games pg
      LEFT JOIN projects p ON p.id = pg.project_id
      WHERE pg.id > ${cursor}::uuid
        AND pg.published_scene_data IS NOT NULL
        AND (
          pg.published_scene_data -> 'metadata' -> 'projectType' IS NULL
          OR pg.published_scene_data -> 'metadata' -> 'projectType' = 'null'::jsonb
        )
      ORDER BY pg.id
      LIMIT ${options.batchSize}
    `;
    if (page.length === 0) break;
    for (const row of page) {
      const publicationId = String(row.id);
      const decision = decidePublicationProjectType(row.snapshot, row.project_stated);
      const result: CandidateResult = { publicationId, hasR2Mirror: row.has_r2_mirror === true, ...decision };
      report.candidates += 1;
      report.byReason[decision.reason] += 1;
      report.byDecision[decision.projectType ?? 'unstated'] += 1;
      if (decision.projectType !== null) {
        if (result.hasR2Mirror) report.decidedWithR2Mirror += 1;
        if (options.apply) {
          result.written = await writeDecision(sql, {
            publicationId,
            version: Number(row.version),
            projectType: decision.projectType,
          });
          if (result.written) report.written += 1;
          else report.skippedChangedSinceRead += 1;
        }
      }
      report.results.push(result);
    }
    cursor = String(page[page.length - 1].id);
  }
  return report;
}

/**
 * The human-readable report. Carries publication ids only (with `--list`):
 * no user ids, slugs, titles or scene content.
 */
export function formatBackfillReport(report: BackfillReport, list: boolean): string {
  const lines = [
    report.apply ? 'Mode: APPLY (writes published_games.published_scene_data)' : 'Mode: DRY RUN (nothing written; re-run with --apply to write)',
    `Publications: ${report.totalPublications}`,
    `  already state a type:            ${report.alreadyStated}`,
    `  no stored snapshot (live project, not a candidate): ${report.noSnapshot}`,
    `  candidates (snapshot states no type): ${report.candidates}`,
    'Decisions:',
    `  2d:       ${report.byDecision['2d']}`,
    `  3d:       ${report.byDecision['3d']}`,
    `  unstated: ${report.byDecision.unstated}`,
    'By reason:',
    ...BACKFILL_REASONS.map((reason) => `  ${reason}: ${report.byReason[reason]}`),
    `Decided rows that also name an R2 snapshot: ${report.decidedWithR2Mirror}`,
  ];
  if (report.apply) {
    lines.push(`Written: ${report.written}`);
    lines.push(`Skipped, row changed since it was read: ${report.skippedChangedSinceRead}`);
  }
  if (list) {
    lines.push('Candidates (publication id, decision, reason, r2):');
    for (const r of report.results) {
      const written = r.written === undefined ? '' : r.written ? ' written' : ' not-written';
      lines.push(`  ${r.publicationId} ${r.projectType ?? 'unstated'} ${r.reason}${r.hasR2Mirror ? ' r2' : ''}${written}`);
    }
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  let options: BackfillOptions;
  try {
    options = parseBackfillArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('backfill-publication-project-type: DATABASE_URL is required; provide it through the environment.');
    process.exitCode = 2;
    return;
  }
  // The CI engine-journeys proxy, a no-op everywhere else (#10161).
  applyE2eNeonEndpointOverride();
  const sql = neon(process.env.DATABASE_URL);
  try {
    const report = await runBackfill(sql as unknown as SqlTag, options);
    console.log(formatBackfillReport(report, options.list));
  } catch (error) {
    // A connection failure's message can carry the host, so only the error
    // class and the Postgres SQLSTATE (when there is one) are printed.
    const name = error instanceof Error ? error.name : 'unknown';
    const code = isRecord(error) && typeof error.code === 'string' ? ` ${error.code}` : '';
    console.error(`backfill-publication-project-type: database error (${name}${code}); nothing after the failing query was written`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
