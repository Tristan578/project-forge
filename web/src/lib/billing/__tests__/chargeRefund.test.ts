// @vitest-environment node
/**
 * Real-DB behavioural tests for handleChargeRefunded (PF-480, PF-526, PF-734, F18/#8610).
 *
 * WHAT THE OLD TESTS PROVED (nothing about behaviour)
 * ---------------------------------------------------
 * The previous suite mocked `@/lib/db/client` with a hand-rolled chain and
 * asserted only on the interpolated SQL string and bound params:
 * `cteCall.strings.some(s => s.includes('audit'))`, `values.toContain('charge_refunded:ch_abc')`,
 * `.toContain(1)`, `.includes('NOT EXISTS')`, `.includes('ABS')`. The "idempotency"
 * case (line 178) asserted `mockNeonSqlCalls.length === firstCallCount * 2` — i.e.
 * it asserted the CTE fires *again* on the duplicate, which is the OPPOSITE of
 * proving no double-deduction. A query can contain every right substring and bind
 * every right value and still double-deduct, mis-round, or skip the wrong branch.
 * The mock never executed one line of the CTE, the `refunded_cents` claim guard,
 * the `NOT EXISTS` dedup, or the `idx_credit_txn_idempotent` unique index. It also
 * pinned fake `TIER_MONTHLY_TOKENS` this function never reads.
 *
 * WHAT THESE TESTS PROVE (real Postgres outcomes)
 * -----------------------------------------------
 * `handleChargeRefunded` runs end-to-end against in-process Postgres (PGlite) with
 * the production migration schema: it resolves the user by `stripe_customer_id`,
 * applies its own guards (no user / amountTotal<=0 / amountRefunded<=0), and
 * delegates to both the precise (purchase-based) and fallback (balance-based)
 * reversal paths. Every assertion is on resulting row state — `addon_tokens`,
 * `token_purchases.refunded_cents`, and `credit_transactions`. Idempotency is
 * proven by *sequential* webhook re-fire (Stripe at-least-once redelivery), the
 * exact threat the CTE guards defend against.
 */
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
import { handleChargeRefunded } from '../subscription-lifecycle';

// ───────────────────────── test-local seed / read helpers ─────────────────────

async function seedPurchase(
  sql: NeonSqlAdapter,
  over: {
    userId: string;
    paymentIntent: string;
    tokens: number;
    amountCents: number;
    pkg?: 'spark' | 'blaze' | 'inferno';
    refundedCents?: number;
  },
): Promise<string> {
  const rows = await sql`
    INSERT INTO token_purchases (user_id, stripe_payment_intent, package, tokens, amount_cents, refunded_cents)
    VALUES (
      ${over.userId}, ${over.paymentIntent}, ${over.pkg ?? 'blaze'},
      ${over.tokens}, ${over.amountCents}, ${over.refundedCents ?? 0}
    )
    RETURNING id
  `;
  return String(rows[0].id);
}

async function addonBalance(sql: NeonSqlAdapter, userId: string): Promise<number> {
  const row = await getUserRow(sql, userId);
  return Number(row?.addon_tokens ?? -1);
}

async function refundedCents(sql: NeonSqlAdapter, purchaseId: string): Promise<number> {
  const rows = await sql`SELECT refunded_cents FROM token_purchases WHERE id = ${purchaseId}::uuid`;
  return Number(rows[0]?.refunded_cents ?? -1);
}

async function creditTxns(sql: NeonSqlAdapter, userId: string): Promise<QueryRow[]> {
  return sql`
    SELECT amount, balance_after, transaction_type, source, reference_id
    FROM credit_transactions
    WHERE user_id = ${userId}::uuid
    ORDER BY created_at ASC, id ASC
  `;
}

async function totalCreditTxns(sql: NeonSqlAdapter): Promise<number> {
  const rows = await sql`SELECT count(*)::int AS n FROM credit_transactions`;
  return Number(rows[0]?.n ?? -1);
}

beforeAll(async () => {
  harnessRef.current = await createTestHarness();
});
afterAll(async () => {
  await harnessRef.current?.close();
});
beforeEach(async () => {
  await harness().truncateAll();
});

describe('handleChargeRefunded — wrapper guards (no mutation)', () => {
  it('does nothing when no user matches the Stripe customer', async () => {
    const sql = harness().neonSql;
    // A different user exists; the refund targets an unknown customer.
    const other = await seedUser(sql, { stripeCustomerId: 'cus_other', addonTokens: 5000 });

    await handleChargeRefunded('cus_unknown', 'ch_x', 2450, 4900, 'pi_x');

    expect(await addonBalance(sql, other.id)).toBe(5000);
    expect(await totalCreditTxns(sql)).toBe(0);
  });

  it('does nothing for a zero refund amount', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { stripeCustomerId: 'cus_z', addonTokens: 5000 });

    await handleChargeRefunded('cus_z', 'ch_z', 0, 4900);

    expect(await addonBalance(sql, user.id)).toBe(5000);
    expect(await totalCreditTxns(sql)).toBe(0);
  });

  it('does nothing for a negative refund amount', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { stripeCustomerId: 'cus_neg', addonTokens: 5000 });

    await handleChargeRefunded('cus_neg', 'ch_neg', -100, 4900);

    expect(await addonBalance(sql, user.id)).toBe(5000);
    expect(await totalCreditTxns(sql)).toBe(0);
  });

  it('does nothing for a zero (or negative) charge total', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { stripeCustomerId: 'cus_t0', addonTokens: 5000 });

    await handleChargeRefunded('cus_t0', 'ch_t0', 100, 0);
    expect(await addonBalance(sql, user.id)).toBe(5000);

    await handleChargeRefunded('cus_t0', 'ch_tn', 100, -50);
    expect(await addonBalance(sql, user.id)).toBe(5000);

    expect(await totalCreditTxns(sql)).toBe(0);
  });
});

describe('handleChargeRefunded — fallback path (no matching purchase)', () => {
  it('deducts proportionally from the addon balance on a partial refund', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { stripeCustomerId: 'cus_p', addonTokens: 1000 });

    // refundRatio = 2450/4900 = 0.5 → FLOOR(1000 × 0.5) = 500.
    // This fractional ratio threw `invalid input syntax for type integer` before
    // the ${refundRatio}::float8 cast — the mock never executed it, so it passed.
    await handleChargeRefunded('cus_p', 'ch_p', 2450, 4900);

    expect(await addonBalance(sql, user.id)).toBe(500);
    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(1);
    expect(Number(txns[0].amount)).toBe(-500);
    expect(Number(txns[0].balance_after)).toBe(500);
    expect(txns[0].transaction_type).toBe('adjustment');
    expect(txns[0].source).toBe('charge_refunded:ch_p');
    // reference_id carries the per-tranche key `${chargeId}:${amountRefunded}`
    // (#8706) — the cumulative amount disambiguates incremental refunds of one
    // charge. `source` keeps the charge-level grouping key.
    expect(txns[0].reference_id).toBe('ch_p:2450');
  });

  it('deducts the entire addon balance on a full refund', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { stripeCustomerId: 'cus_f', addonTokens: 1000 });

    await handleChargeRefunded('cus_f', 'ch_f', 4900, 4900);

    expect(await addonBalance(sql, user.id)).toBe(0);
    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(1);
    expect(Number(txns[0].amount)).toBe(-1000);
  });

  it('clamps the refund ratio to 1 when the refund exceeds the charge total', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { stripeCustomerId: 'cus_o', addonTokens: 1000 });

    // ratio = min(10000/4900, 1) = 1 → deduct all 1000.
    await handleChargeRefunded('cus_o', 'ch_o', 10000, 4900);

    expect(await addonBalance(sql, user.id)).toBe(0);
    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(1);
    expect(Number(txns[0].amount)).toBe(-1000);
  });

  it('writes nothing when the user has zero addon tokens (SQL guard)', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { stripeCustomerId: 'cus_n0', addonTokens: 0 });

    await handleChargeRefunded('cus_n0', 'ch_n0', 4900, 4900);

    expect(await addonBalance(sql, user.id)).toBe(0);
    expect(await creditTxns(sql, user.id)).toHaveLength(0);
  });

  it('does not double-deduct when the identical refund webhook is re-fired (NOT EXISTS)', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { stripeCustomerId: 'cus_d', addonTokens: 1000 });

    await handleChargeRefunded('cus_d', 'ch_d', 2450, 4900);
    // Stripe at-least-once redelivery: the same event arrives again.
    await handleChargeRefunded('cus_d', 'ch_d', 2450, 4900);

    // Second call: a prior credit_transactions row with the same user/source/
    // reference_id exists → NOT EXISTS is false → audit inserts nothing → no UPDATE.
    expect(await addonBalance(sql, user.id)).toBe(500);
    expect(await creditTxns(sql, user.id)).toHaveLength(1);
  });
});

describe('handleChargeRefunded — precise path (paymentIntent matches a purchase)', () => {
  it('deducts from the purchase token count and claims refunded_cents (full refund)', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { stripeCustomerId: 'cus_pr', addonTokens: 5000 });
    const purchaseId = await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_pr',
      tokens: 5000,
      amountCents: 4900,
    });

    await handleChargeRefunded('cus_pr', 'ch_pr', 4900, 4900, 'pi_pr');

    expect(await addonBalance(sql, user.id)).toBe(0);
    expect(await refundedCents(sql, purchaseId)).toBe(4900);
    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(1);
    expect(Number(txns[0].amount)).toBe(-5000);
    expect(txns[0].source).toBe('charge_refunded:ch_pr');
  });

  it('deducts proportionally from the purchase token count (partial refund)', async () => {
    const sql = harness().neonSql;
    // Purchase granted 5000; user later spent 1000, so 4000 addon remain.
    const user = await seedUser(sql, { stripeCustomerId: 'cus_pp', addonTokens: 4000 });
    const purchaseId = await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_pp',
      tokens: 5000,
      amountCents: 4900,
    });

    // FLOOR(5000 × 2450/4900) = 2500 — proportional to the *purchase*, not balance.
    await handleChargeRefunded('cus_pp', 'ch_pp', 2450, 4900, 'pi_pp');

    expect(await addonBalance(sql, user.id)).toBe(1500);
    expect(await refundedCents(sql, purchaseId)).toBe(2450);
    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(1);
    expect(Number(txns[0].amount)).toBe(-2500);
  });

  it('does not double-deduct across the precise path on a re-fired webhook', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { stripeCustomerId: 'cus_pd', addonTokens: 5000 });
    const purchaseId = await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_pd',
      tokens: 5000,
      amountCents: 4900,
    });

    await handleChargeRefunded('cus_pd', 'ch_pd', 4900, 4900, 'pi_pd');
    await handleChargeRefunded('cus_pd', 'ch_pd', 4900, 4900, 'pi_pd');

    // refunded_cents(4900) < 4900 is false → claim matches 0 rows → CTE no-ops.
    expect(await addonBalance(sql, user.id)).toBe(0);
    expect(await refundedCents(sql, purchaseId)).toBe(4900);
    expect(await creditTxns(sql, user.id)).toHaveLength(1);
  });
});

describe('handleChargeRefunded — comped purchase (amount_cents = 0)', () => {
  it('reclaims the full comped grant rather than no-opping (NULLIF/LEAST clawback)', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { stripeCustomerId: 'cus_comp', addonTokens: 5000 });
    const purchaseId = await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_comp',
      tokens: 5000,
      amountCents: 0, // comped grant — no money was charged
    });

    // NULLIF(amount_cents, 0) → NULL, so the proportion division is NULL and
    // LEAST(NULL, 1) collapses to 1 → FLOOR(tokens × 1) = all 5000 tokens,
    // capped at the addon balance. A comped refund reclaims everything it gave.
    await handleChargeRefunded('cus_comp', 'ch_comp', 100, 100, 'pi_comp');

    expect(await addonBalance(sql, user.id)).toBe(0);
    expect(await refundedCents(sql, purchaseId)).toBe(100);
    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(1);
    expect(Number(txns[0].amount)).toBe(-5000);
    expect(txns[0].source).toBe('charge_refunded:ch_comp');
    expect(txns[0].reference_id).toBe('ch_comp:100');
  });
});

describe('handleChargeRefunded — incremental (partial-then-cumulative) refunds (#8706)', () => {
  // Stripe fires charge.refunded once per refund with a STABLE charge.id and a
  // CUMULATIVE amount_refunded. Keying the audit row on chargeId alone collided
  // on idx_credit_txn_idempotent: the second tranche's INSERT hit the duplicate
  // key, the whole CTE rolled back, the clawback was permanently lost, and the
  // webhook 500'd into an infinite Stripe retry. The per-tranche refundRef
  // (`${chargeId}:${amountRefunded}`) makes every tranche a distinct key.

  it('precise path: records BOTH tranches and deducts the full amount', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { stripeCustomerId: 'cus_inc', addonTokens: 5000 });
    const purchaseId = await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_inc',
      tokens: 5000,
      amountCents: 4900,
    });

    // 1st refund: 2450c (50%) → FLOOR(5000 × 2450/4900) = 2500 deducted.
    await handleChargeRefunded('cus_inc', 'ch_inc', 2450, 4900, 'pi_inc');
    expect(await addonBalance(sql, user.id)).toBe(2500);
    expect(await refundedCents(sql, purchaseId)).toBe(2450);

    // 2nd refund: CUMULATIVE 4900c. Before #8706 this collided on reference_id
    // 'ch_inc' → 23505 → whole CTE rolled back → 2nd clawback LOST, addon stuck
    // at 2500. After: distinct key 'ch_inc:4900', delta = (4900-2450)/4900 → 2500.
    await handleChargeRefunded('cus_inc', 'ch_inc', 4900, 4900, 'pi_inc');
    expect(await addonBalance(sql, user.id)).toBe(0);
    expect(await refundedCents(sql, purchaseId)).toBe(4900);

    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(2);
    expect(txns.map(t => Number(t.amount))).toEqual([-2500, -2500]);
    expect(txns.map(t => t.reference_id)).toEqual(['ch_inc:2450', 'ch_inc:4900']);
    expect(txns.every(t => t.source === 'charge_refunded:ch_inc')).toBe(true);
  });

  it('precise path: a true redelivery (same cumulative amount) stays an exact no-op', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { stripeCustomerId: 'cus_inc2', addonTokens: 5000 });
    await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_inc2',
      tokens: 5000,
      amountCents: 4900,
    });

    await handleChargeRefunded('cus_inc2', 'ch_inc2', 2450, 4900, 'pi_inc2');
    // Exact redelivery of the FIRST tranche (same 2450) — claim guard sees
    // refunded_cents(2450) < 2450 is false → 0 rows → no second row, no deduction.
    await handleChargeRefunded('cus_inc2', 'ch_inc2', 2450, 4900, 'pi_inc2');

    expect(await addonBalance(sql, user.id)).toBe(2500);
    expect(await creditTxns(sql, user.id)).toHaveLength(1);
  });

  it('fallback path: records BOTH tranches, no silent under-deduction', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { stripeCustomerId: 'cus_fbinc', addonTokens: 1000 });

    // 1st refund: 50% of CURRENT balance (1000) → 500 deducted.
    await handleChargeRefunded('cus_fbinc', 'ch_fbinc', 500, 1000);
    expect(await addonBalance(sql, user.id)).toBe(500);

    // 2nd refund: CUMULATIVE full. Before #8706 reference_id 'ch_fbinc' matched
    // the prior row → NOT EXISTS false → silent no-op → addon stuck at 500
    // (under-deduction). After: distinct key 'ch_fbinc:1000' → 100% of CURRENT
    // balance (500) → 500 deducted. Fallback incremental is approximate by
    // design (no purchase row to anchor exact proportions) but never silently
    // skips a tranche.
    await handleChargeRefunded('cus_fbinc', 'ch_fbinc', 1000, 1000);
    expect(await addonBalance(sql, user.id)).toBe(0);

    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(2);
    expect(txns.map(t => Number(t.amount))).toEqual([-500, -500]);
    expect(txns.map(t => t.reference_id)).toEqual(['ch_fbinc:500', 'ch_fbinc:1000']);
    expect(txns.every(t => t.source === 'charge_refunded:ch_fbinc')).toBe(true);
  });
});
