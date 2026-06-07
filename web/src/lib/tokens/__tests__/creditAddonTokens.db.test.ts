// @vitest-environment node
/**
 * creditAddonTokens — real Postgres behavioural tests (F17 · audit 2026-05-30 · #8609).
 *
 * WHAT THE OLD TESTS PROVED (nothing useful):
 * The mock-based suite in `service.test.ts` asserted that the interpolated SQL
 * *string* contained `'ON CONFLICT'` / `'DO NOTHING'` and that the package's
 * token count appeared somewhere in the bound values. A query can contain every
 * one of those substrings and still credit the wrong amount, credit twice, or
 * write a duplicate purchase row — the audit (F17) flagged exactly this: the
 * tests "never assert the credited amount".
 *
 * WHAT THESE TESTS PROVE:
 * The real single-CTE statement runs against in-process Postgres (PGlite) and we
 * assert on the resulting rows — the exact credited balance per package, that
 * exactly one purchase row is written with the right tokens/amount_cents, and
 * that a redelivered Stripe webhook (same payment_intent, fired sequentially)
 * credits nothing the second time. The idempotency guard is the DB's
 * `ON CONFLICT (stripe_payment_intent) DO NOTHING` + `EXISTS (SELECT 1 FROM ins)`,
 * so it can only be verified by running the statement, not by reading its text.
 *
 * Harness: see `@/lib/db/__tests__/pgliteHarness`. No production code changes —
 * the SUT still imports `@/lib/db/client`; we `vi.mock` that module so
 * `getNeonSql()` / `getDb()` / `queryWithResilience()` resolve to the harness.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeonSqlAdapter, QueryRow, TestHarness } from '@/lib/db/__tests__/pgliteHarness';

const harnessRef = vi.hoisted(() => ({ current: null as TestHarness | null }));

function harness(): TestHarness {
  const h = harnessRef.current;
  if (!h) throw new Error('PGlite harness not initialised');
  return h;
}

vi.mock('@/lib/db/client', () => ({
  getNeonSql: () => harness().neonSql,
  getDb: () => harness().db,
  queryWithResilience: <T>(operation: () => Promise<T>): Promise<T> => operation(),
}));

import { createTestHarness, getUserRow, seedUser } from '@/lib/db/__tests__/pgliteHarness';
import { type TokenPackage } from '@/lib/tokens/pricing';
import { creditAddonTokens } from '@/lib/tokens/service';

beforeAll(async () => {
  harnessRef.current = await createTestHarness();
});

afterAll(async () => {
  await harnessRef.current?.close();
});

beforeEach(async () => {
  await harness().truncateAll();
});

async function purchaseRows(sql: NeonSqlAdapter, userId: string): Promise<QueryRow[]> {
  return sql`
    SELECT package, tokens, amount_cents, refunded_cents, stripe_payment_intent
    FROM token_purchases
    WHERE user_id = ${userId}::uuid
    ORDER BY created_at
  `;
}

async function addonBalance(sql: NeonSqlAdapter, userId: string): Promise<number> {
  const row = await getUserRow(sql, userId);
  return Number(row?.addon_tokens);
}

// The credited amounts ARE the product spec — see TOKEN_PACKAGES in pricing.ts.
// Hard-coding them here (not importing) makes a silent pricing change fail the
// test loudly instead of the test tracking the constant it is meant to guard.
const PACKAGE_CASES: ReadonlyArray<{ pkg: TokenPackage; tokens: number; cents: number }> = [
  { pkg: 'spark', tokens: 1000, cents: 1200 },
  { pkg: 'blaze', tokens: 5000, cents: 4900 },
  { pkg: 'inferno', tokens: 20000, cents: 14900 },
];

describe('creditAddonTokens — real Postgres behaviour (F17, #8609)', () => {
  for (const { pkg, tokens, cents } of PACKAGE_CASES) {
    it(`credits exactly ${tokens} add-on tokens and records one ${pkg} purchase`, async () => {
      const sql = harness().neonSql;
      const user = await seedUser(sql, { addonTokens: 0 });

      await creditAddonTokens(user.id, pkg, `pi_${pkg}_1`);

      expect(await addonBalance(sql, user.id)).toBe(tokens);

      const rows = await purchaseRows(sql, user.id);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].tokens)).toBe(tokens);
      expect(Number(rows[0].amount_cents)).toBe(cents);
      expect(rows[0].package).toBe(pkg);
      expect(rows[0].stripe_payment_intent).toBe(`pi_${pkg}_1`);
      expect(Number(rows[0].refunded_cents)).toBe(0);
    });
  }

  it('adds to an existing add-on balance instead of overwriting it', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 250 });

    await creditAddonTokens(user.id, 'spark', 'pi_existing');

    expect(await addonBalance(sql, user.id)).toBe(1250);
  });

  it('is idempotent: a redelivered webhook (same payment_intent) credits nothing the second time', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 0 });

    await creditAddonTokens(user.id, 'blaze', 'pi_dup');
    expect(await addonBalance(sql, user.id)).toBe(5000);
    expect(await purchaseRows(sql, user.id)).toHaveLength(1);

    // Stripe's at-least-once delivery re-fires the same event. Sequential re-fire
    // is the exact shape the ON CONFLICT + EXISTS(ins) guard defends against.
    await creditAddonTokens(user.id, 'blaze', 'pi_dup');

    expect(await addonBalance(sql, user.id)).toBe(5000);
    expect(await purchaseRows(sql, user.id)).toHaveLength(1);
  });

  it('stacks distinct purchases for the same user (idempotency is keyed on payment_intent, not user)', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 0 });

    await creditAddonTokens(user.id, 'spark', 'pi_a');
    await creditAddonTokens(user.id, 'spark', 'pi_b');

    expect(await addonBalance(sql, user.id)).toBe(2000);
    expect(await purchaseRows(sql, user.id)).toHaveLength(2);
  });

  it('credits only the target user, leaving other balances untouched', async () => {
    const sql = harness().neonSql;
    const target = await seedUser(sql, { addonTokens: 0 });
    const bystander = await seedUser(sql, { addonTokens: 777 });

    await creditAddonTokens(target.id, 'inferno', 'pi_target');

    expect(await addonBalance(sql, target.id)).toBe(20000);
    expect(await addonBalance(sql, bystander.id)).toBe(777);
    expect(await purchaseRows(sql, bystander.id)).toHaveLength(0);
  });

  it('ignores a payment_intent already used by another user (global UNIQUE idempotency)', async () => {
    // uq_token_purchases_payment_intent is global on stripe_payment_intent, so a
    // second insert re-using a seen intent hits ON CONFLICT → no row → no credit.
    // (Stripe payment_intents are globally unique in practice; this documents the
    // guard's true scope rather than a naive per-user one.)
    const sql = harness().neonSql;
    const first = await seedUser(sql, { addonTokens: 0 });
    const second = await seedUser(sql, { addonTokens: 0 });

    await creditAddonTokens(first.id, 'spark', 'pi_shared');
    await creditAddonTokens(second.id, 'spark', 'pi_shared');

    expect(await addonBalance(sql, first.id)).toBe(1000);
    expect(await addonBalance(sql, second.id)).toBe(0);
  });
});
