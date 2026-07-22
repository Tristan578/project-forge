// @vitest-environment node
// (pgliteHarness resolves web/drizzle/ via import.meta.url, which is not a
// file:// URL under the jsdom default of the standalone vitest.config.ts —
// same docblock pattern as creditAddonTokens.db.test.ts.)
/**
 * Schema ↔ migration-chain parity (#8707).
 *
 * WHY THIS EXISTS
 * ---------------
 * Production carries schema via BOTH `drizzle-kit push` (dev convenience that
 * leaked into prod history) and the migration files in `web/drizzle/`. Anything
 * pushed but never captured in a migration is invisible drift: the live DB has
 * it, but a database provisioned purely from migration history (fresh CI DB,
 * disaster-recovery restore, new region) does not. That bit twice before this
 * test existed — `users.banned` (read on the auth path: api-auth.ts rejects
 * `user.banned > 0`) and `token_purchases.refunded_cents` (partial-refund money
 * path) were schema.ts-only, and the leaderboards/moderation-appeals tables had
 * no CREATE TABLE migration at all.
 *
 * WHAT IT PROVES
 * --------------
 * For EVERY pgTable exported from schema.ts, `db.select().from(table).limit(0)`
 * runs against a PGlite provisioned ONLY by replaying `web/drizzle/*.sql`
 * (see pgliteHarness buildSchema — no reconciliations, no push). Drizzle names
 * every schema.ts column in the generated SELECT, so a table or column that the
 * migration chain does not create throws `relation/column ... does not exist`.
 * New drift therefore fails CI the moment schema.ts gains a table/column with
 * no accompanying migration.
 *
 * SCOPE
 * -----
 * Covers existence of tables, columns, and named indexes (and, transitively,
 * the enum types those tables' columns require — CREATE TABLE fails during
 * harness build if an enum is missing). Index parity reads each table's
 * `index()`/`uniqueIndex()` declarations via Drizzle's `getTableConfig` and
 * asserts the name exists in pg_indexes — this caught `idx_published_games_slug`
 * existing only in schema.ts. It does NOT diff column types, defaults, or
 * index column lists/predicates; those stay on the reviewed-migration honor
 * system.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTableName, is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../schema';
import { createTestHarness, type TestHarness } from './pgliteHarness';

const tables: [string, PgTable][] = Object.values(schema as Record<string, unknown>)
  .filter((candidate): candidate is PgTable => is(candidate, PgTable))
  .map((table) => [getTableName(table), table]);

// Schema-only placeholder indexes: deliberate stand-ins for the partial/
// expression unique indexes Drizzle's DSL cannot model (no WHERE predicates,
// no jsonb-expression columns — see the NOTE comments in schema.ts). The
// migration chain creates the REAL ON CONFLICT arbiter under a different name,
// so parity asserts the arbiter exists instead of the placeholder. Do NOT add
// the placeholders to a migration: they would be redundant write-amplifying
// twins of the real index on hot money-path tables.
const SCHEMA_ONLY_PLACEHOLDERS: Record<string, string> = {
  // 0005_token_usage_refund_idempotent_index_concurrent.sql
  idx_token_usage_refund_idempotent_schema: 'uq_token_usage_refund_idempotent',
  // 0002_credit_txn_idempotent_index.sql
  idx_credit_txn_idempotent_schema: 'idx_credit_txn_idempotent',
};

// Every index()/uniqueIndex() declared in schema.ts, grouped by table, with
// placeholders mapped to the real index the migrations must create. An unnamed
// index has no runtime name (its generated name lives in drizzle-kit, not in
// getTableConfig), so it cannot be checked here — the enumeration test below
// therefore REJECTS unnamed indexes outright rather than skipping them.
const unnamedIndexTables: string[] = tables.flatMap(([name, table]) =>
  getTableConfig(table).indexes.some((ix) => typeof ix.config.name !== 'string') ? [name] : [],
);

const tableIndexes: [string, string[]][] = tables
  .map(([name, table]): [string, string[]] => [
    name,
    getTableConfig(table)
      .indexes.map((ix) => ix.config.name)
      .filter((ixName): ixName is string => typeof ixName === 'string')
      .map((ixName) => SCHEMA_ONLY_PLACEHOLDERS[ixName] ?? ixName),
  ])
  .filter(([, names]) => names.length > 0);

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});

afterAll(async () => {
  // Defensive: if beforeAll threw before assigning harness, afterAll still runs
  // and must not mask the real beforeAll failure with a TypeError of its own.
  // (One historical failure mode: PGlite 0.5.x has no pgvector, so the graph
  // migration's `CREATE EXTENSION vector` / `vector(1536)` / HNSW index threw
  // during harness build. That is now handled by the pgvector-compat shim in
  // pgliteHarness.ts buildSchema — PF-985 #8977 — not left as a skip.)
  if (harness) {
    await harness.close();
  }
});

describe('schema.ts ↔ migration-chain parity (#8707)', () => {
  it('enumerates the schema (a refactor that empties this list must fail loudly)', () => {
    expect(tables.length).toBeGreaterThanOrEqual(20);
    // An unnamed index() still reaches production via db:push under a
    // drizzle-kit-generated name the migration chain never carries — the exact
    // drift class this file exists to catch — but it is invisible to the
    // pg_indexes check above. Reject it here instead of silently skipping it.
    expect(unnamedIndexTables).toEqual([]);
    expect(tableIndexes.flatMap(([, names]) => names).length).toBeGreaterThanOrEqual(30);
  });

  it.each(tables)('migrations create %s with every schema.ts column', async (_name, table) => {
    // limit(0): we only care that Postgres accepts the column list, not rows —
    // and a 0-row select is always exactly [].
    await expect(harness.db.select().from(table).limit(0)).resolves.toEqual([]);
  });

  it.each(tableIndexes)('migrations create every schema.ts index on %s', async (name, declared) => {
    const result = await harness.pglite.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1",
      [name],
    );
    const existing = new Set(result.rows.map((row) => row.indexname));
    const missing = declared.filter((ixName) => !existing.has(ixName));
    expect(missing).toEqual([]);
  });
});
