/**
 * Refuse `drizzle-kit push` against a migrate-managed database (#9979).
 *
 * `push` and `migrate` are mutually exclusive ownership models. `push` diffs
 * `schema.ts` directly onto the database and writes no journal; `migrate`
 * applies recorded migrations in order and records each one. Pushing over a
 * migrate-managed database silently desynchronises the schema from the
 * migration history and leaves nothing behind to reveal it.
 *
 * That is exactly #9969. Production was pushed — by `cd.yml`, not by hand — so
 * it carried whatever `schema.ts` looked like at the last successful push:
 * seven tables, two columns and two unique indexes short of the migration set,
 * with no journal to make the gap visible. Two of those indexes were the
 * idempotency guards on the credit and refund paths, absent on a database with
 * a live Stripe key.
 *
 * THE JOURNAL IS THE SIGNAL. Its rows mean "migrations own this database".
 * Nothing here inspects the URL: a host allowlist would have to be maintained
 * by hand, would not survive a branch rename, and would say nothing about which
 * tool owns the schema. The journal answers exactly the right question.
 */

/** Flag that lets an operator push over a migrate-managed database anyway. */
export const PUSH_CONFIRM_FLAG = '--confirm=PUSH_OVER_MIGRATIONS';

export interface PushGuardState {
  /** Rows in `drizzle.__drizzle_migrations`, or `null` when the table is absent. */
  journalRowCount: number | null;
  /** Whether the operator passed {@link PUSH_CONFIRM_FLAG}. */
  confirmed: boolean;
}

export function assertPushAllowed(state: PushGuardState): void {
  const { journalRowCount, confirmed } = state;

  // No journal, or a journal with nothing recorded: nothing is being
  // desynchronised, so push is a legitimate choice here.
  if (journalRowCount === null || journalRowCount === 0) return;

  if (confirmed) return;

  throw new Error(
    `Refusing to push: this database is migrate-managed (${journalRowCount} ` +
      'migration(s) recorded in drizzle.__drizzle_migrations). Pushing would ' +
      'desynchronise the schema from the migration history — see #9969. Use ' +
      '`npm run db:migrate` instead. To override deliberately, re-run with ' +
      `${PUSH_CONFIRM_FLAG}.`,
  );
}

// --- CLI -------------------------------------------------------------------
// Guarded by the same `import.meta.url === argv[1]` pattern as
// baseline-drizzle-journal.ts, so importing this module from a test never
// executes it.

async function main(): Promise<void> {
  const { neon } = await import('@neondatabase/serverless');

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is required; provide it through the environment, never a CLI argument',
    );
  }

  const sql = neon(process.env.DATABASE_URL);
  const journalTable = (await sql.query(
    "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS table_name",
  )) as Array<{ table_name: string | null }>;

  const journalRowCount = journalTable[0]?.table_name
    ? ((await sql.query(
        'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
      )) as Array<{ count: number }>)[0]?.count ?? 0
    : null;

  assertPushAllowed({
    journalRowCount,
    confirmed: process.argv.includes(PUSH_CONFIRM_FLAG),
  });

  console.log(JSON.stringify({ pushGuard: 'passed', journalRowCount }));
}

if (process.argv[1]) {
  const { pathToFileURL } = await import('node:url');
  if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
