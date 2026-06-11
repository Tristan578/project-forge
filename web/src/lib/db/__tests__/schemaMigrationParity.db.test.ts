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
 * Covers existence of tables and columns (and, transitively, the enum types
 * those tables' columns require — CREATE TABLE fails during harness build if an
 * enum is missing). It does NOT diff column types, defaults, or indexes; those
 * stay on the reviewed-migration honor system.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../schema';
import { createTestHarness, type TestHarness } from './pgliteHarness';

const tables: [string, PgTable][] = Object.values(schema as Record<string, unknown>)
  .filter((candidate): candidate is PgTable => is(candidate, PgTable))
  .map((table) => [getTableName(table), table]);

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});

afterAll(async () => {
  await harness.close();
});

describe('schema.ts ↔ migration-chain parity (#8707)', () => {
  it('enumerates the schema (a refactor that empties this list must fail loudly)', () => {
    expect(tables.length).toBeGreaterThanOrEqual(20);
  });

  it.each(tables)('migrations create %s with every schema.ts column', async (_name, table) => {
    // limit(0): we only care that Postgres accepts the column list, not rows.
    await expect(harness.db.select().from(table).limit(0)).resolves.toBeDefined();
  });
});
