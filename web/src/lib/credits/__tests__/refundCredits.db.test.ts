// @vitest-environment node
/**
 * refundCredits — real Postgres behavioural tests + arbiter source contract (#8729).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The #8729 review board found that `refundCredits` carries the exact anti-pattern
 * the branch fixes in `reverseAddonTokens`' fallback clawback path: an INSERT into
 * `credit_transactions` with a non-NULL `reference_id` (source `'credit_refund'`,
 * reference `transactionId`) guarded ONLY by a snapshot-level `NOT EXISTS`
 * subquery. Two CONCURRENT refunds for the same transactionId both pass the
 * `NOT EXISTS`, and the loser then raises a unique violation on the
 * `idx_credit_txn_idempotent` partial unique index — a loud 500 instead of a clean
 * no-op. (No double-credit occurs either way: the balance UPDATE is EXISTS-gated
 * on the CTE's RETURNING output.)
 *
 * KNOWN CONSTRAINT: PGlite is single-connection, so the true concurrent race
 * cannot be reproduced behaviourally here (sequential calls commit between
 * statements, so the second call's NOT EXISTS always sees the first row). The
 * accepted composite — identical to the reverseAddonTokens #8729 suite — is:
 *   (a) a source-contract test pinning the exact ON CONFLICT arbiter clause onto
 *       the refund audit CTE (red pre-fix, green post-fix), and
 *   (b) behavioural tests proving the post-fix statement executes end-to-end
 *       against real Postgres (PGlite rejects a malformed arbiter at parse time)
 *       and that sequential redelivery stays a clean no-op (no error, no extra
 *       audit row, no double credit).
 *
 * Harness: see `@/lib/db/__tests__/pgliteHarness`. No production code changes —
 * the SUT still imports `@/lib/db/client`; we `vi.mock` that module so
 * `getNeonSql()` / `getDb()` / `queryWithResilience()` resolve to the harness.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeonSqlAdapter, QueryRow, TestHarness } from '@/lib/db/__tests__/pgliteHarness';

const harnessRef = vi.hoisted(() => ({ current: null as TestHarness | null }));
function harness(): TestHarness {
  const h = harnessRef.current;
  if (!h) throw new Error('PGlite harness not initialised');
  return h;
}

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/client', () => ({
  getNeonSql: () => harness().neonSql,
  getDb: () => harness().db,
  queryWithResilience: <T>(operation: () => Promise<T>): Promise<T> => operation(),
}));

import { createTestHarness, getUserRow, seedUser } from '@/lib/db/__tests__/pgliteHarness';
import { refundCredits } from '../creditManager';

beforeAll(async () => {
  harnessRef.current = await createTestHarness();
});
afterAll(async () => {
  await harnessRef.current?.close();
});
beforeEach(async () => {
  await harness().truncateAll();
});

async function addonBalance(sql: NeonSqlAdapter, userId: string): Promise<number> {
  const row = await getUserRow(sql, userId);
  return Number(row?.addon_tokens ?? -1);
}

async function creditTxns(sql: NeonSqlAdapter, userId: string): Promise<QueryRow[]> {
  return sql`
    SELECT amount, balance_after, transaction_type, source, reference_id
    FROM credit_transactions
    WHERE user_id = ${userId}::uuid
    ORDER BY created_at ASC, id ASC
  `;
}

describe('refundCredits — audit CTE ON CONFLICT arbiter (#8729)', () => {
  it('refund audit CTE carries the ON CONFLICT arbiter between its NOT EXISTS guard and RETURNING (source contract)', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../creditManager.ts', import.meta.url)),
      'utf8',
    );

    // `WITH ins AS (` opens the refund CTE and appears nowhere else in the file.
    const cteStart = src.indexOf('WITH ins AS (');
    expect(cteStart, 'refund CTE (`WITH ins AS (`) not found').toBeGreaterThan(-1);

    const returningIdx = src.indexOf('RETURNING id', cteStart);
    expect(returningIdx, 'refund CTE RETURNING not found').toBeGreaterThan(cteStart);

    const auditCte = src.slice(cteStart, returningIdx);

    // The snapshot-level fast path must be KEPT — it suppresses the credit
    // arithmetic cheaply on ordinary sequential retries.
    expect(auditCte).toContain('NOT EXISTS');

    // The arbiter must sit between the INSERT's SELECT source and RETURNING,
    // mirroring reverseAddonTokens (#8729): a concurrent loser that passed
    // NOT EXISTS in its snapshot degrades to a no-op instead of a unique
    // violation on idx_credit_txn_idempotent.
    const arbiter =
      'ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING';
    expect(auditCte, `refund audit CTE must carry the arbiter:\n${auditCte}`).toContain(arbiter);
    expect(auditCte.indexOf(arbiter)).toBeGreaterThan(auditCte.indexOf('NOT EXISTS'));
  });

  it('first refund credits the addon pool once and writes a single audit row', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 100 });

    const result = await refundCredits(user.id, 250, 'txn_8729_a');

    expect(result.success).toBe(true);
    expect(result.balance.purchased).toBe(350);
    expect(result.balance.total).toBe(350);
    expect(await addonBalance(sql, user.id)).toBe(350);

    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(1);
    expect(txns[0].transaction_type).toBe('refund');
    expect(txns[0].source).toBe('credit_refund');
    expect(txns[0].reference_id).toBe('txn_8729_a');
    expect(Number(txns[0].amount)).toBe(250);
    // balance_after = monthly remaining (0) + addon pre-credit (100) + amount (250) + earned (0)
    expect(Number(txns[0].balance_after)).toBe(350);
  });

  it('identical sequential redelivery resolves as a clean no-op: no error, no extra row, no double credit', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 100 });

    await refundCredits(user.id, 250, 'txn_8729_dup');

    // The same refund is requested again (retry / redelivery). It must RESOLVE
    // (never reject) and change nothing. This also proves the post-fix
    // statement — with the ON CONFLICT clause in place — still executes
    // end-to-end against real Postgres (PGlite would reject a malformed
    // arbiter at parse time).
    const second = await refundCredits(user.id, 250, 'txn_8729_dup');
    expect(second.success).toBe(true);
    expect(second.balance.purchased).toBe(350);

    expect(await addonBalance(sql, user.id)).toBe(350);
    expect(await creditTxns(sql, user.id)).toHaveLength(1);
  });

  it('a different transactionId is NOT suppressed by a prior refund (idempotency is per-transaction)', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 0 });

    await refundCredits(user.id, 100, 'txn_8729_x');
    await refundCredits(user.id, 40, 'txn_8729_y');

    expect(await addonBalance(sql, user.id)).toBe(140);

    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(2);
    expect(txns.map((t) => t.reference_id)).toEqual(['txn_8729_x', 'txn_8729_y']);
  });
});
