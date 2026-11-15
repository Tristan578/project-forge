/**
 * Apply pending Drizzle migrations to the database in `DATABASE_URL`.
 *
 * WHY THIS EXISTS RATHER THAN `drizzle-kit migrate` (#9979)
 * ---------------------------------------------------------
 * `drizzle-kit migrate` does not work against this project. Measured on a
 * scratch Neon branch wiped to an empty schema (2026-09-11):
 *
 *   $ npx drizzle-kit migrate
 *   Using '@neondatabase/serverless' driver for database querying
 *   Warning  '@neondatabase/serverless' can only connect ... through a websocket
 *   EXIT=1
 *
 * Exit 1, **no error message**, nothing applied — 0 tables, 0 journal rows. It
 * reports success only when there is nothing to do, which is the worst possible
 * failure shape: it would have passed every rehearsal against an up-to-date
 * database and failed silently the first time it mattered.
 *
 * `drizzle-orm`'s own migrator, against the identical URL and the identical
 * migration folder, applied all 13 migrations and produced 32 tables, 13 journal
 * rows, the `vector` extension, and both `CREATE INDEX CONCURRENTLY` indexes.
 *
 * CONCURRENTLY: `0002` and `0005` create partial unique indexes with
 * `CREATE INDEX CONCURRENTLY`, which Postgres forbids inside a transaction. The
 * neon-http driver issues each statement as its own request rather than wrapping
 * a migration file in a transaction, so these apply cleanly. VERIFIED on the
 * scratch branch, not inferred: `idx_credit_txn_idempotent` and
 * `uq_token_usage_refund_idempotent` both exist after a from-zero run.
 *
 * FAILURE IS LOUD, AND IT NAMES THE MIGRATION (#10161). Any error is printed
 * with its cause and the process exits non-zero. That is the entire point of
 * replacing `drizzle-kit push` in `cd.yml`: push exits 0 on failure, applies
 * untransacted, and silently skips a destructive diff in CI (see
 * `scripts/db-migration-guard.sh`), which is how production drifted across four
 * migrations without anything going red (#9969).
 *
 * The migrator itself cannot say WHICH migration failed: it runs every pending
 * migration's statements and records every journal row only after the whole
 * chain applied (node_modules/drizzle-orm/neon-http/migrator.js), so a failure
 * leaves the journal untouched, and the driver's error carries Postgres's text
 * but not the statement. What it does offer is the `logger` hook, called with
 * each statement's text immediately before it executes. The last statement
 * logged is the one that failed, and the migration file it was split from is
 * the migration to name — `describeMigrationFailure` below. A statement that
 * repeats, across migrations or inside one, is placed by how far the log had
 * got through the pending migrations' statements (`locateLastStatement`), not
 * by its text, which would blame the earlier file or the first copy. Pure
 * helpers, tested in `scripts/__tests__/apply-migrations.test.ts`.
 */
import { pathToFileURL } from 'node:url';
import { neon } from '@neondatabase/serverless';
import type { Logger } from 'drizzle-orm/logger';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { applyE2eNeonEndpointOverride } from '../src/lib/db/e2eNeonEndpoint.ts';
import { loadMigrationRecords, type MigrationRecord } from './baseline-drizzle-journal.ts';

const MIGRATIONS_FOLDER = 'drizzle';

/** One migration file, as drizzle splits it, under the tag the journal gives it. */
export interface MigrationStatements {
  tag: string;
  statements: readonly string[];
}

/** A drizzle `Logger` that remembers every statement, in the order it was logged. */
export interface StatementRecorder {
  logger: Logger;
  /** The last statement the migrator handed the driver, or null before the first. */
  lastStatement(): string | null;
  /** Every statement the migrator handed the driver, in order. */
  statements(): readonly string[];
}

/**
 * Build the recorder the migrator logs through. Drizzle calls `logQuery`
 * before executing each statement, so whatever this holds when `migrate`
 * throws is the statement that failed.
 */
export function createStatementRecorder(): StatementRecorder {
  const logged: string[] = [];
  return {
    logger: {
      logQuery(query: string): void {
        logged.push(query);
      },
    },
    lastStatement: () => logged[logged.length - 1] ?? null,
    statements: () => logged,
  };
}

/**
 * Pair drizzle's reading of the migration folder (statements, no tag) with
 * the journal's (tag and timestamp, no statements). Both iterate
 * `meta/_journal.json` in order, so the pairing is positional, and the
 * timestamp on each side is checked so a tag can never name the wrong file.
 *
 * @throws When the two readings disagree on length or on any timestamp.
 */
export function zipMigrationStatements(
  metas: readonly MigrationMeta[],
  records: readonly MigrationRecord[],
): MigrationStatements[] {
  if (metas.length !== records.length) {
    throw new Error(
      `drizzle read ${metas.length} migration file(s) but the journal has ${records.length} journal entr(y/ies); refusing to name migrations from a mismatched pairing`,
    );
  }
  return metas.map((meta, index) => {
    const record = records[index]!;
    if (meta.folderMillis !== record.when) {
      throw new Error(
        `migration ${record.tag} is recorded at ${record.when} in the journal but drizzle read its file at ${meta.folderMillis}; refusing to name migrations from a mismatched pairing`,
      );
    }
    return { tag: record.tag, statements: meta.sql };
  });
}

/**
 * Every distinct message along an error's `cause` chain, outermost first.
 * drizzle wraps the driver's error (`Failed query: <sql>\nparams: `) around
 * the one that carries Postgres's own text, and the first mutation run of
 * #10161 printed only the wrapper — the Postgres message surfaced nowhere but
 * the service container's log. Cycles terminate; non-Error links are
 * stringified.
 */
export function causeMessages(error: unknown): string[] {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    const message = current instanceof Error ? current.message : String(current);
    if (message !== '' && !messages.includes(message)) messages.push(message);
    current = current instanceof Error ? current.cause : undefined;
  }
  return messages;
}

/** The innermost message of the chain — for a failed statement, Postgres's own. */
export function rootCauseMessage(error: unknown): string {
  const messages = causeMessages(error);
  return messages[messages.length - 1] ?? String(error);
}

const MAX_QUOTED_STATEMENT_CHARS = 120;

/** Where one statement sits: which migration file, and which statement in it. */
export interface StatementLocation {
  /** Index into `migrations` of the file the statement was split from. */
  migrationIndex: number;
  /** Zero-based position of the statement within that file. */
  statementIndex: number;
}

/**
 * Where the migrator was when the last statement was logged: which migration,
 * and which of its statements. Null when that cannot be told.
 *
 * Matching the failed statement's TEXT cannot say, because a statement can
 * repeat across migrations (`CREATE EXTENSION IF NOT EXISTS vector;` is
 * idempotent, so a later migration has every reason to repeat it) or inside
 * one (two identical seed INSERTs, the second of which violates a unique key),
 * and the first match would blame the earlier file or the first copy. What the
 * migrator does is deterministic: after its own bookkeeping it runs the
 * PENDING migrations' statements in order. The log is therefore a prefix of
 * their concatenation, and walking the log against that concatenation names
 * the migration AND the position of the last statement exactly — how many of
 * the migration's statements had run when it stopped.
 *
 * @param logged Every statement the recorder saw, in order.
 * @param migrations Every migration file, paired with its tag.
 * @param pending Indices into `migrations` the migrator was going to apply.
 * @returns null before any migration statement ran, or when the LAST logged
 *   statement is not the one the walk expected — an earlier statement's
 *   location must not stand in for a statement the walk could not place.
 */
export function locateLastStatement(
  logged: readonly string[],
  migrations: readonly MigrationStatements[],
  pending: readonly number[],
): StatementLocation | null {
  const expected = pending.flatMap((migrationIndex) =>
    (migrations[migrationIndex]?.statements ?? []).map((statement, statementIndex) => ({
      migrationIndex,
      statementIndex,
      text: statement.trim(),
    })),
  );
  let cursor = 0;
  let current: StatementLocation | null = null;
  let lastAligned = false;
  for (const statement of logged) {
    const next = expected[cursor];
    if (next !== undefined && next.text === statement.trim()) {
      current = { migrationIndex: next.migrationIndex, statementIndex: next.statementIndex };
      cursor += 1;
      lastAligned = true;
    } else {
      lastAligned = false;
    }
  }
  return lastAligned ? current : null;
}

/**
 * Which migration the migrator was applying when the last statement was
 * logged, as an index into `migrations`, or null when that cannot be told.
 * The migration half of `locateLastStatement`.
 */
export function currentMigrationIndex(
  logged: readonly string[],
  migrations: readonly MigrationStatements[],
  pending: readonly number[],
): number | null {
  return locateLastStatement(logged, migrations, pending)?.migrationIndex ?? null;
}

/** The read drizzle's migrator makes to decide what is pending (neon-http/migrator.js). */
const NEWEST_JOURNAL_ROW_SQL =
  'select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1';

/**
 * After a failed `migrate`, find the migration it was applying and the
 * statement within it.
 *
 * The migrator applies a migration only when the journal's newest row is older
 * than that migration's timestamp, and it inserts journal rows only after EVERY
 * statement applied, so a failure leaves the journal exactly as the migrator
 * read it: reading it again names the migrations that were pending. The read
 * is made AFTER the failure, not before, so the success path — the production
 * deploy — issues no query it did not issue before.
 *
 * Never throws: this refines an error message, and losing the refinement (the
 * database may be unreachable, which can be why `migrate` failed) must not
 * replace the real failure. Null falls back to the first matching statement.
 *
 * @param query Runs one SQL text against the database.
 * @param logged Every statement the recorder saw, in order.
 * @param migrations Every migration file, paired with its tag.
 * @param folderMillis Each migration's timestamp, in the same order.
 */
export async function findApplyingStatement(
  query: (text: string) => Promise<unknown>,
  logged: readonly string[],
  migrations: readonly MigrationStatements[],
  folderMillis: readonly number[],
): Promise<StatementLocation | null> {
  try {
    const rows = (await query(NEWEST_JOURNAL_ROW_SQL)) as Array<{ created_at: string | number | null }>;
    const raw = rows[0]?.created_at;
    const newest = raw === undefined || raw === null ? null : Number(raw);
    // A timestamp that is not a number is not an empty journal: reading it as
    // one would call every migration pending.
    if (newest !== null && !Number.isFinite(newest)) return null;
    const pending = folderMillis.flatMap((millis, index) =>
      newest === null || newest < millis ? [index] : [],
    );
    return locateLastStatement(logged, migrations, pending);
  } catch {
    return null;
  }
}

/**
 * The migration half of `findApplyingStatement`: which migration was being
 * applied, as an index into `migrations`, or null when that cannot be told.
 */
export async function findApplyingMigration(
  query: (text: string) => Promise<unknown>,
  logged: readonly string[],
  migrations: readonly MigrationStatements[],
  folderMillis: readonly number[],
): Promise<number | null> {
  const location = await findApplyingStatement(query, logged, migrations, folderMillis);
  return location?.migrationIndex ?? null;
}

/**
 * Say where a failed `migrate` call was when it threw.
 *
 * @param lastStatement What the recorder holds: the statement being executed.
 * @param migrations Every migration file, paired with its tag.
 * @param applyingIndex The migration the migrator was applying (see
 *   `findApplyingStatement`). Preferred when that migration holds the
 *   statement, so a statement repeated in an earlier migration is not blamed
 *   on it. Null, or an index whose migration lacks the statement, falls back to
 *   the first migration that holds it.
 * @param statementIndex Zero-based position of the failed statement within the
 *   applying migration, derived from the log (`locateLastStatement`). Used
 *   as-is when that migration holds the statement there, so the second of two
 *   identical statements is reported as the second. Null, or a position that
 *   does not hold the statement, searches the migration's text for it instead:
 *   the first copy, which is the best a text search can do.
 * @returns A phrase that completes "Migration failed ...".
 */
export function describeMigrationFailure(
  lastStatement: string | null,
  migrations: readonly MigrationStatements[],
  applyingIndex: number | null = null,
  statementIndex: number | null = null,
): string {
  if (lastStatement === null) {
    return 'before any migration statement ran (preparing the drizzle journal table)';
  }
  // readMigrationFiles splits on `--> statement-breakpoint` and keeps the
  // surrounding newlines; drizzle logs the statement exactly as split, so the
  // comparison tolerates whitespace on either side and nothing else.
  const wanted = lastStatement.trim();
  const applying = applyingIndex === null ? undefined : migrations[applyingIndex];
  if (applying !== undefined && statementIndex !== null) {
    // A position is trusted only where it holds the statement that failed; one
    // that does not would invent a location.
    if (applying.statements[statementIndex]?.trim() === wanted) {
      return `while applying migration ${applying.tag} (statement ${statementIndex + 1} of ${applying.statements.length})`;
    }
  }
  const candidates = applying === undefined ? migrations : [applying, ...migrations];
  for (const migration of candidates) {
    const position = migration.statements.findIndex((statement) => statement.trim() === wanted);
    if (position !== -1) {
      return `while applying migration ${migration.tag} (statement ${position + 1} of ${migration.statements.length})`;
    }
  }
  const quoted =
    wanted.length > MAX_QUOTED_STATEMENT_CHARS
      ? `${wanted.slice(0, MAX_QUOTED_STATEMENT_CHARS)} [truncated]`
      : wanted;
  return `outside any migration file, on drizzle's own bookkeeping statement: ${quoted}`;
}

/**
 * What `main()` does when `migrate` throws, as one function so that the
 * composition is tested: find where the migrator was (migration and position,
 * from the journal and the log) and say it.
 *
 * @param query Runs one SQL text against the database.
 * @param recorder What the migrator logged through `createStatementRecorder`.
 * @param migrations Every migration file, paired with its tag.
 * @param folderMillis Each migration's timestamp, in the same order.
 * @returns A phrase that completes "Migration failed ...". Never throws.
 */
export async function describeApplyFailure(
  query: (text: string) => Promise<unknown>,
  recorder: Pick<StatementRecorder, 'lastStatement' | 'statements'>,
  migrations: readonly MigrationStatements[],
  folderMillis: readonly number[],
): Promise<string> {
  const where = await findApplyingStatement(query, recorder.statements(), migrations, folderMillis);
  return describeMigrationFailure(
    recorder.lastStatement(),
    migrations,
    where?.migrationIndex ?? null,
    where?.statementIndex ?? null,
  );
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is required; provide it through the environment, never a CLI argument',
    );
  }

  // The CI engine-journeys job migrates a per-run Postgres through a local
  // Neon-protocol proxy; this is a no-op everywhere else (#10161).
  applyE2eNeonEndpointOverride();
  const sql = neon(process.env.DATABASE_URL);
  const recorder = createStatementRecorder();
  const db = drizzle(sql, { logger: recorder.logger });

  // The same files the migrator is about to read, under the journal's tags,
  // so a failure can be named. Read BEFORE migrating: a journal that does not
  // pair with its files is a reason not to start.
  const metas = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  const migrations = zipMigrationStatements(metas, await loadMigrationRecords());

  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } catch (error) {
    // The one-line annotation names the migration, the statement's position in
    // it, AND Postgres's own message; the wrapper with the full statement
    // follows as a cause line. Where a statement repeated across migrations or
    // inside one is blamed depends on where the migrator was, so that is
    // derived from the journal and the log rather than guessed from text.
    const where = await describeApplyFailure(
      (text) => sql.query(text),
      recorder,
      migrations,
      metas.map((meta) => meta.folderMillis),
    );
    throw new Error(`${where}: ${rootCauseMessage(error)}`, { cause: error });
  }

  // Report what the database now believes, so a CI log shows the outcome rather
  // than only the absence of an error.
  const rows = (await sql.query(
    'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
  )) as Array<{ count: number }>;
  console.log(
    JSON.stringify({ migrationsApplied: true, journalRows: rows[0]?.count ?? 0 }),
  );
}

// A STATIC import and a synchronous guard, as in assert-push-allowed.ts:
// `npm run db:migrate` runs this file through tsx as CommonJS, where esbuild
// refuses a top-level `await`; and importing this module from a test must never
// execute it (#10190).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const [headline, ...causes] = causeMessages(error);
    console.error('::error::Migration failed', headline ?? String(error));
    for (const cause of causes) {
      console.error('Cause:', cause);
    }
    process.exitCode = 1;
  });
}
