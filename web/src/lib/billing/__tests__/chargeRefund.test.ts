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
  // No monotonic insertion column exists: `id` is a random UUID (not a serial),
  // so `id ASC` is lexical-on-random — it does NOT reflect write order. And
  // `created_at` is transaction-time `now()`, which ties for rows written in the
  // same statement/transaction. We therefore order by the deterministic,
  // meaningful tranche key (`reference_id`) so single-row reads are stable; any
  // multi-row assertion additionally `.sort()`s to stay independent of the
  // ordering of equal-`created_at` rows.
  return sql`
    SELECT amount, balance_after, transaction_type, source, reference_id
    FROM credit_transactions
    WHERE user_id = ${userId}::uuid
    ORDER BY created_at ASC, reference_id ASC NULLS LAST
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
    // balance_after snapshots the post-clawback balance the SUT itself computed:
    // GREATEST(0, monthly−used) + GREATEST(0, addon−deduct) + earned = 0+0+0.
    // A mutant that writes the pre-refund balance (or omits the addon term) is
    // caught here, where the bare `amount`/`source` asserts above pass it.
    expect(Number(txns[0].balance_after)).toBe(0);
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
    // Non-zero remainder: GREATEST(0, 4000−2500) = 1500 (monthly/earned both 0).
    // This pins the running balance, not just the delta — the value a credits
    // ledger UI and the next deduction both read.
    expect(Number(txns[0].balance_after)).toBe(1500);
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

  it('deducts only the incremental delta when the purchase already carries a prior partial refund (refundedCents override)', async () => {
    // Independent wrapper-suite guard for the precise-path delta-vs-cumulative
    // arithmetic. The incremental test above depletes the addon balance in
    // lockstep with the refund, so the GREATEST(0, …)/LEAST(…) clamps mask a
    // cumulative-amount regression (a mutant deducting the CUMULATIVE total
    // still floors to the same 0). Seeding a prior partial refund alongside a
    // HIGH addon balance makes the two arithmetics diverge observably.
    const sql = harness().neonSql;
    // A 5000-token / 4900c purchase already 50%-refunded (refunded_cents=2450,
    // 2500 tokens already clawed back), plus 1500 addon tokens from elsewhere →
    // 4000 addon remain.
    const user = await seedUser(sql, { stripeCustomerId: 'cus_delta', addonTokens: 4000 });
    const purchaseId = await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_delta',
      tokens: 5000,
      amountCents: 4900,
      refundedCents: 2450,
    });

    // The rest of the refund lands as a cumulative 4900c.
    await handleChargeRefunded('cus_delta', 'ch_delta', 4900, 4900, 'pi_delta');

    // Deduction is the DELTA (4900 − 2450), NOT the cumulative total:
    // FLOOR(5000 × 2450/4900) = 2500 → addon 4000 → 1500. A mutant using the
    // cumulative 4900 would deduct the full 4000 and floor addon to 0.
    expect(await addonBalance(sql, user.id)).toBe(1500);
    expect(await refundedCents(sql, purchaseId)).toBe(4900);
    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(1);
    expect(Number(txns[0].amount)).toBe(-2500);
    expect(txns[0].reference_id).toBe('ch_delta:4900');
  });

  it('caps the audited clawback at the remaining addon balance when the purchase granted more than the user still holds (LEAST cap)', async () => {
    // The precise-path audit amount is -LEAST(tokens_to_deduct, addon_tokens):
    // the ledger may never record clawing back more tokens than the user
    // actually held. The partial-refund test above keeps tokens_to_deduct (2500)
    // BELOW the balance (4000), so LEAST always picks tokens_to_deduct and the
    // cap is never exercised — a mutant dropping LEAST to a bare
    // `-d.tokens_to_deduct` survives it. This case makes tokens_to_deduct exceed
    // the balance so the cap is the only thing keeping the audit honest.
    const sql = harness().neonSql;
    // Purchase granted 5000 tokens; the user has since spent 2000, leaving 3000.
    const user = await seedUser(sql, { stripeCustomerId: 'cus_cap', addonTokens: 3000 });
    const purchaseId = await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_cap',
      tokens: 5000,
      amountCents: 4900,
    });

    // Full refund → tokens_to_deduct = FLOOR(5000 × 4900/4900) = 5000, but only
    // 3000 addon tokens remain. The audit row must book -LEAST(5000, 3000) =
    // -3000 (and balance_after 0), never the phantom -5000 a missing LEAST cap
    // would write. The balance floors to 0 either way (GREATEST(0, …)), so the
    // ledger amount is the ONLY observable that separates correct from mutant.
    await handleChargeRefunded('cus_cap', 'ch_cap', 4900, 4900, 'pi_cap');

    expect(await addonBalance(sql, user.id)).toBe(0);
    expect(await refundedCents(sql, purchaseId)).toBe(4900);
    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(1);
    expect(Number(txns[0].amount)).toBe(-3000); // LEAST cap — NOT the raw -5000
    expect(Number(txns[0].balance_after)).toBe(0);
    expect(txns[0].source).toBe('charge_refunded:ch_cap');
    expect(txns[0].reference_id).toBe('ch_cap:4900');
  });
});

describe('handleChargeRefunded — cross-path idempotency (fallback then precise)', () => {
  it('does not double-deduct when a fallback refund is followed by a precise refund of the SAME charge', async () => {
    // Real Stripe race: charge.refunded arrives before the checkout.session
    // webhook has written the token_purchases row, so the first delivery takes
    // the FALLBACK path; the row lands; the at-least-once redelivery then finds
    // the purchase and takes the PRECISE path. Both paths key the audit row on
    // the SAME (user, source=`charge_refunded:<charge>`, reference_id=`<charge>:<amt>`),
    // so the precise INSERT hits ON CONFLICT DO NOTHING → the `audit` CTE is empty
    // → `EXISTS (SELECT 1 FROM audit)` is false → the precise UPDATE is suppressed.
    // Deleting that gate would let the precise path deduct a SECOND time off an
    // already-reversed balance — this test is its executable proof.
    const sql = harness().neonSql;
    const user = await seedUser(sql, { stripeCustomerId: 'cus_xp', addonTokens: 20000 });

    // Delivery 1 — no purchase row yet → fallback: FLOOR(20000 × 2450/4900) = 10000.
    await handleChargeRefunded('cus_xp', 'ch_xp', 2450, 4900, 'pi_xp');
    expect(await addonBalance(sql, user.id)).toBe(10000);

    // The purchase row arrives late, then the SAME charge is redelivered → precise.
    const purchaseId = await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_xp',
      tokens: 5000,
      amountCents: 4900,
    });
    await handleChargeRefunded('cus_xp', 'ch_xp', 2450, 4900, 'pi_xp');

    // No second deduction: addon stays 10000, exactly one ledger row for the charge.
    // (The precise path still CLAIMS refunded_cents — harmless bookkeeping — but
    // the EXISTS(audit) gate blocks the balance mutation.)
    expect(await addonBalance(sql, user.id)).toBe(10000);
    expect(await refundedCents(sql, purchaseId)).toBe(2450);
    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(1);
    expect(Number(txns[0].amount)).toBe(-10000);
    expect(txns[0].reference_id).toBe('ch_xp:2450');
    expect(txns[0].source).toBe('charge_refunded:ch_xp');
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
    // 'ch_inc' → unique_violation (SQLSTATE 23505) → whole CTE rolled back → 2nd
    // clawback LOST, addon stuck at 2500. After: distinct key 'ch_inc:4900',
    // delta = (4900-2450)/4900 → 2500.
    await handleChargeRefunded('cus_inc', 'ch_inc', 4900, 4900, 'pi_inc');
    expect(await addonBalance(sql, user.id)).toBe(0);
    expect(await refundedCents(sql, purchaseId)).toBe(4900);

    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(2);
    // Both tranche rows share created_at (transaction-time now()), so assert the
    // SET of rows order-independently — never depend on a random-UUID tiebreaker.
    expect(txns.map(t => Number(t.amount)).sort((a, b) => a - b)).toEqual([-2500, -2500]);
    expect(txns.map(t => String(t.reference_id)).sort()).toEqual(['ch_inc:2450', 'ch_inc:4900']);
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
    // Order-independent: both rows tie on created_at. Sorted lexically,
    // 'ch_fbinc:1000' precedes 'ch_fbinc:500' ('1' < '5').
    expect(txns.map(t => Number(t.amount)).sort((a, b) => a - b)).toEqual([-500, -500]);
    expect(txns.map(t => String(t.reference_id)).sort()).toEqual(['ch_fbinc:1000', 'ch_fbinc:500']);
    expect(txns.every(t => t.source === 'charge_refunded:ch_fbinc')).toBe(true);
  });

  it('fallback path: a NEW addon purchase between tranches does NOT inflate the clawback (stable-base #8706)', async () => {
    // TEETH for the stable-base reconstruction. The lockstep test above depletes
    // the balance in step with the refund, so a naive "deduct a ratio of the
    // CURRENT balance" implementation computes the same 500 for the 2nd tranche
    // and SURVIVES. Here the user BUYS 1000 more addon tokens between deliveries,
    // so current-balance-ratio and the shipped stable-base math diverge
    // observably: the later tranche must anchor to the ORIGINAL refunded base
    // (reconstructed from the recorded prior clawback: amountRefunded ×
    // prior_clawed / prior_cum_cents − prior_clawed), NEVER to the inflated live
    // balance. The SUT comment promises exactly this ("a NEW addon purchase
    // landing between webhook deliveries can never inflate the clawback"); this is
    // its executable proof.
    const sql = harness().neonSql;
    const user = await seedUser(sql, { stripeCustomerId: 'cus_fbbuy', addonTokens: 1000 });

    // T1: 50% cumulative → FLOOR(1000 × 500/1000) = 500 deducted, addon 1000→500.
    await handleChargeRefunded('cus_fbbuy', 'ch_fbbuy', 500, 1000);
    expect(await addonBalance(sql, user.id)).toBe(500);

    // User buys a fresh 1000-token addon pack BEFORE the next refund tranche.
    await sql`UPDATE users SET addon_tokens = addon_tokens + 1000 WHERE id = ${user.id}::uuid`;
    expect(await addonBalance(sql, user.id)).toBe(1500);

    // T2: CUMULATIVE 1000/1000. Stable-base: target = 1000 × prior_clawed(500) /
    // prior_cum_cents(500) = 1000; delta = 1000 − 500 = 500 → addon 1500→1000.
    // A current-balance-ratio mutant deducts 100% of 1500 = 1500 → addon 0.
    await handleChargeRefunded('cus_fbbuy', 'ch_fbbuy', 1000, 1000);

    // The newly bought 1000 tokens are untouched: addon = 1000, NOT 0.
    expect(await addonBalance(sql, user.id)).toBe(1000);
    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(2);
    // The 2nd tranche books the DELTA (-500), never the inflated balance (-1500).
    const second = txns.find(t => String(t.reference_id) === 'ch_fbbuy:1000')!;
    expect(Number(second.amount)).toBe(-500);
    expect(Number(second.balance_after)).toBe(1000);
    expect(txns.map(t => Number(t.amount)).sort((a, b) => a - b)).toEqual([-500, -500]);
    expect(txns.map(t => String(t.reference_id)).sort()).toEqual(['ch_fbbuy:1000', 'ch_fbbuy:500']);
    expect(txns.every(t => t.source === 'charge_refunded:ch_fbbuy')).toBe(true);
  });
});
