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
 * FAILURE IS LOUD. Any error is printed with its cause and the process exits
 * non-zero. That is the entire point of replacing `drizzle-kit push` in
 * `cd.yml`: push exits 0 on failure, applies untransacted, and silently skips a
 * destructive diff in CI (see `scripts/db-migration-guard.sh`), which is how
 * production drifted across four migrations without anything going red (#9969).
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

const MIGRATIONS_FOLDER = 'drizzle';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is required; provide it through the environment, never a CLI argument',
    );
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql);

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  // Report what the database now believes, so a CI log shows the outcome rather
  // than only the absence of an error.
  const rows = (await sql.query(
    'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
  )) as Array<{ count: number }>;
  console.log(
    JSON.stringify({ migrationsApplied: true, journalRows: rows[0]?.count ?? 0 }),
  );
}

main().catch((error: unknown) => {
  console.error(
    'Migration failed:',
    error instanceof Error ? error.message : String(error),
  );
  if (error instanceof Error && error.cause) {
    console.error('Cause:', String(error.cause));
  }
  process.exitCode = 1;
});
