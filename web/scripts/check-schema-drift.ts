/**
 * Fail loudly when the target database has drifted from the migration set (#9980).
 *
 * WHY THIS EXISTS
 * ---------------
 * Nothing detected #9969. Production was seven tables, two columns and two
 * unique indexes short of the migration set for an unknown length of time, and
 * the only reason it surfaced was a cron happening to query one of the missing
 * tables — which then took seven days to notice because the health monitor was
 * itself blind (#9981). Absence of alerts was absence of traffic, not evidence
 * of health.
 *
 * TWO INDEPENDENT QUESTIONS, because either can be wrong on its own:
 *
 *   1. Does the physical schema match `schema.ts`? Answered by
 *      `assertSchemaMatches`, which is REUSED here rather than reimplemented —
 *      it already walks every table, every column and every index, and during
 *      the #9969 repair it caught two missing columns and two missing indexes
 *      that a table-level diff could not see. It also refuses a vacuous audit
 *      (`tables.length < 20`), so a run that discovers nothing fails instead of
 *      reporting a clean scan.
 *
 *   2. Does `drizzle.__drizzle_migrations` agree with `drizzle/meta/_journal.json`?
 *      A schema can match `schema.ts` while the journal is missing entries — that
 *      is precisely the state production was left in by `drizzle-kit push`, and
 *      it is what makes the next `migrate` refuse to run.
 *
 * Exit codes: 0 clean, 1 drift (the message names the objects), 2 tooling error.
 */
import { neon } from '@neondatabase/serverless';

import {
  assertSchemaMatches,
  loadMigrationRecords,
  planBaseline,
  type JournalRecord,
} from './baseline-drizzle-journal.ts';

type QueryClient = Parameters<typeof assertSchemaMatches>[0];

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error(
      '::error::check-schema-drift: DATABASE_URL is required; provide it through the environment.',
    );
    process.exitCode = 2;
    return;
  }

  const sql = neon(process.env.DATABASE_URL);
  const problems: string[] = [];

  // 1. Physical schema vs schema.ts. Throws naming the missing objects.
  try {
    await assertSchemaMatches(sql as unknown as QueryClient);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  // 2. Journal vs the repository's migration folder.
  const migrations = await loadMigrationRecords();
  if (migrations.length === 0) {
    console.error(
      '::error::check-schema-drift: no repository migrations found — refusing a vacuous comparison.',
    );
    process.exitCode = 2;
    return;
  }

  const journalTable = (await sql.query(
    "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS table_name",
  )) as Array<{ table_name: string | null }>;

  if (!journalTable[0]?.table_name) {
    problems.push(
      'drizzle.__drizzle_migrations does not exist — the database is not ' +
        'migrate-managed. Run `npm run db:baseline` (it verifies the schema ' +
        'before recording anything).',
    );
  } else {
    const rows = (await sql.query(
      'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
    )) as unknown as JournalRecord[];
    const plan = planBaseline(migrations, rows);
    if (plan.missing.length > 0) {
      problems.push(
        `journal is missing ${plan.missing.length} migration(s): ` +
          plan.missing.map((m) => m.tag).join(', '),
      );
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`::error::check-schema-drift: ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify({
      schemaDrift: 'none',
      migrationsInRepo: migrations.length,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(
    '::error::check-schema-drift: unexpected failure:',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 2;
});
