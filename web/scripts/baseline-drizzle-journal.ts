import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { getTableName, is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../src/lib/db/schema.ts';

export interface MigrationRecord {
  tag: string;
  when: number;
  hash: string;
}

export interface JournalRecord {
  hash: string;
  created_at: string | number;
}

interface JournalFile {
  entries: Array<{ tag: string; when: number }>;
}

export interface BaselinePlan {
  missing: MigrationRecord[];
  alreadyRecorded: MigrationRecord[];
}

export interface MigrationGuardState {
  applicationTableCount: number;
  journalRowCount: number | null;
}

export function assertMigrationMayRun(state: MigrationGuardState): 'fresh' | 'tracked' {
  if (state.applicationTableCount === 0) return 'fresh';
  if (state.journalRowCount === null || state.journalRowCount === 0) {
    throw new Error(
      'Refusing to migrate a non-empty database with missing migration history; run npm run db:baseline first',
    );
  }
  return 'tracked';
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(scriptDir, '..', 'drizzle');

export async function loadMigrationRecords(
  directory = drizzleDir,
): Promise<MigrationRecord[]> {
  const journal = JSON.parse(
    await readFile(join(directory, 'meta', '_journal.json'), 'utf8'),
  ) as JournalFile;

  return Promise.all(
    journal.entries.map(async ({ tag, when }) => {
      const sql = await readFile(join(directory, `${tag}.sql`), 'utf8');
      return {
        tag,
        when,
        hash: createHash('sha256').update(sql).digest('hex'),
      };
    }),
  );
}

export function planBaseline(
  migrations: MigrationRecord[],
  journalRows: JournalRecord[],
): BaselinePlan {
  const expectedByTimestamp = new Map(migrations.map((migration) => [migration.when, migration]));
  const seenTimestamps = new Set<number>();
  const alreadyRecorded: MigrationRecord[] = [];

  for (const row of journalRows) {
    const timestamp = Number(row.created_at);
    if (!Number.isSafeInteger(timestamp)) {
      throw new Error(`Migration journal contains an invalid created_at value: ${row.created_at}`);
    }
    if (seenTimestamps.has(timestamp)) {
      throw new Error(`Migration journal contains duplicate timestamp ${timestamp}`);
    }
    seenTimestamps.add(timestamp);

    const expected = expectedByTimestamp.get(timestamp);
    if (!expected) {
      throw new Error(`Migration journal contains unknown timestamp ${timestamp}`);
    }
    if (row.hash !== expected.hash) {
      throw new Error(`Migration journal hash conflict for ${expected.tag}`);
    }
    alreadyRecorded.push(expected);
  }

  return {
    missing: migrations.filter((migration) => !seenTimestamps.has(migration.when)),
    alreadyRecorded,
  };
}

export interface QueryClient {
  query(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}

export async function assertSchemaMatches(client: QueryClient): Promise<void> {
  const tables = Object.values(schema as Record<string, unknown>)
    .filter((candidate): candidate is PgTable => is(candidate, PgTable))
    .map((table) => ({ name: getTableName(table), config: getTableConfig(table) }));

  if (tables.length < 20) {
    throw new Error(`Schema discovery found only ${tables.length} tables; refusing a vacuous audit`);
  }

  const tableNames = tables.map((table) => table.name);
  const existingTables = (await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [tableNames],
  )) as Array<{ table_name: string }>;
  const existingTableNames = new Set(existingTables.map((row) => row.table_name));
  const missingTables = tableNames.filter((name) => !existingTableNames.has(name));
  if (missingTables.length > 0) {
    throw new Error(`Schema audit failed; missing tables: ${missingTables.join(', ')}`);
  }

  const expectedColumns = tables.flatMap((table) =>
    table.config.columns.map((column) => ({ table: table.name, column: column.name })),
  );
  const existingColumns = (await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [tableNames],
  )) as Array<{ table_name: string; column_name: string }>;
  const existingColumnKeys = new Set(
    existingColumns.map((row) => `${row.table_name}.${row.column_name}`),
  );
  const missingColumns = expectedColumns
    .map(({ table, column }) => `${table}.${column}`)
    .filter((key) => !existingColumnKeys.has(key));
  if (missingColumns.length > 0) {
    throw new Error(`Schema audit failed; missing columns: ${missingColumns.join(', ')}`);
  }

  const schemaOnlyIndexAliases: Record<string, string> = {
    idx_token_usage_refund_idempotent_schema: 'uq_token_usage_refund_idempotent',
    idx_credit_txn_idempotent_schema: 'idx_credit_txn_idempotent',
  };
  const expectedIndexes = tables.flatMap((table) =>
    table.config.indexes.map((index) => {
      if (!index.config.name) {
        throw new Error(`Schema audit cannot baseline unnamed index on ${table.name}`);
      }
      return schemaOnlyIndexAliases[index.config.name] ?? index.config.name;
    }),
  );
  const existingIndexes = (await client.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
    [expectedIndexes],
  )) as Array<{ indexname: string }>;
  const existingIndexNames = new Set(existingIndexes.map((row) => row.indexname));
  const missingIndexes = expectedIndexes.filter((name) => !existingIndexNames.has(name));
  if (missingIndexes.length > 0) {
    throw new Error(`Schema audit failed; missing indexes: ${missingIndexes.join(', ')}`);
  }

  const duplicatePurchases = (await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM token_purchases
       WHERE stripe_payment_intent IS NOT NULL
       GROUP BY stripe_payment_intent HAVING count(*) > 1
     ) AS found`,
  )) as Array<{ found: boolean }>;
  if (duplicatePurchases[0]?.found) {
    throw new Error('Schema audit failed; duplicate token purchase rows violate migration 0003');
  }

  const duplicateRefunds = (await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM token_usage
       WHERE operation IN ('refund', 'partial_refund')
         AND metadata->>'refundedUsageId' IS NOT NULL
       GROUP BY user_id, operation, metadata->>'refundedUsageId'
       HAVING count(*) > 1
     ) AS found`,
  )) as Array<{ found: boolean }>;
  if (duplicateRefunds[0]?.found) {
    throw new Error('Schema audit failed; duplicate refund rows violate migration 0004');
  }
}

async function main(): Promise<void> {
  const guardMigrate = process.argv.includes('--guard-migrate');
  const apply = process.argv.includes('--apply');
  const confirmed = process.argv.includes('--confirm=BASELINE_VERIFIED_SCHEMA');
  if (apply && !confirmed) {
    throw new Error('--apply requires --confirm=BASELINE_VERIFIED_SCHEMA');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required; provide it through the environment, never a CLI argument');
  }

  const migrations = await loadMigrationRecords();
  if (migrations.length === 0) throw new Error('No repository migrations found');

  const sql = neon(process.env.DATABASE_URL);

  if (guardMigrate) {
    const tableCount = (await sql.query(
      `SELECT count(*)::int AS count FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    )) as Array<{ count: number }>;
    const journalTable = (await sql.query(
      `SELECT to_regclass('drizzle.__drizzle_migrations')::text AS table_name`,
    )) as Array<{ table_name: string | null }>;
    const journalCount = journalTable[0]?.table_name
      ? ((await sql.query(
          'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
        )) as Array<{ count: number }>)[0]?.count ?? 0
      : null;
    const state = assertMigrationMayRun({
      applicationTableCount: tableCount[0]?.count ?? 0,
      journalRowCount: journalCount,
    });
    if (state === 'tracked') {
      const rows = (await sql.query(
        'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
      )) as unknown as JournalRecord[];
      planBaseline(migrations, rows);
    }
    console.log(JSON.stringify({ migrationPreflight: 'passed', state }));
    return;
  }

  await assertSchemaMatches(sql as unknown as QueryClient);

  const journalTable = (await sql.query(
    `SELECT to_regclass('drizzle.__drizzle_migrations')::text AS table_name`,
  )) as Array<{ table_name: string | null }>;
  const rows = journalTable[0]?.table_name
    ? ((await sql.query(
        'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
      )) as unknown as JournalRecord[])
    : [];
  const plan = planBaseline(migrations, rows);

  console.log(
    JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      schemaVerified: true,
      recorded: plan.alreadyRecorded.map((migration) => migration.tag),
      missing: plan.missing.map((migration) => migration.tag),
    }),
  );

  if (!apply || plan.missing.length === 0) return;

  const statements = [
    sql`CREATE SCHEMA IF NOT EXISTS drizzle`,
    sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_drizzle_migrations_created_at
      ON drizzle.__drizzle_migrations (created_at)`,
    ...plan.missing.map(
      (migration) => sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        SELECT ${migration.hash}, ${migration.when}
        WHERE NOT EXISTS (
          SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${migration.when}
        )`,
    ),
  ];
  await sql.transaction(statements);

  const verifiedRows = (await sql.query(
    'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
  )) as unknown as JournalRecord[];
  const verified = planBaseline(migrations, verifiedRows);
  if (verified.missing.length > 0) {
    throw new Error(`Baseline verification failed; missing ${verified.missing.length} journal rows`);
  }
  console.log(JSON.stringify({ mode: 'apply', baselineVerified: true, rows: migrations.length }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
