// @vitest-environment node
/**
 * Real-DB behavioural tests for reverseAddonTokens (PF-734, PF-7514, #8187, F16/#8608).
 *
 * WHAT THE OLD TESTS PROVED (nothing about behaviour)
 * ---------------------------------------------------
 * The previous suite mocked `@/lib/db/client` and asserted on the *interpolated
 * SQL string and bound parameters* — `findCteCall('claim')` exists, the values
 * array `.toContain(4900)`, the template text `.toContain('NOT EXISTS')`,
 * `.toContain(0.5)`. Every "idempotency" case asserted only that
 * `mockNeonTransaction` was not called. A query can contain the right substring,
 * bind the right number, and still double-deduct, mis-round, or skip the wrong
 * branch — the mock never executed a single line of the CTE arithmetic, the
 * `refunded_cents` claim guard, or the `NOT EXISTS` dedup. The mock even pinned
 * fake `TIER_MONTHLY_TOKENS` values that this function never reads.
 *
 * WHAT THESE TESTS PROVE (real Postgres outcomes)
 * -----------------------------------------------
 * The SUT runs against an in-process Postgres (PGlite) with the production
 * migration schema — including the `idx_credit_txn_idempotent` partial unique
 * index and the `refunded_cents` claim column the idempotency depends on. Every
 * assertion is on resulting row state: the user's `addon_tokens`, the purchase's
 * `refunded_cents`, and the `credit_transactions` audit rows. Idempotency is
 * proven by *sequential* webhook re-fire (the shape Stripe at-least-once
 * redelivery produces), the exact threat the CTE guards defend against.
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
import { reverseAddonTokens } from '../subscription-lifecycle';

// ───────────────────────── test-local seed / read helpers ─────────────────────
// The shared harness seeds only `users`; purchase rows are inserted via its neon
// adapter here so this file owns its own `token_purchases` fixtures. The optional
// `refundedCents` override seeds a row that already carries a prior partial
// refund, exercising the incremental-refund delta arithmetic (#8706).

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

beforeAll(async () => {
  harnessRef.current = await createTestHarness();
});
afterAll(async () => {
  await harnessRef.current?.close();
});
beforeEach(async () => {
  await harness().truncateAll();
});

describe('reverseAddonTokens — precise purchase-based path (PF-734, PF-7514)', () => {
  it('deducts the full purchase token count and claims refunded_cents on a full refund', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 5000 });
    const purchaseId = await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_full',
      tokens: 5000,
      amountCents: 4900,
    });

    await reverseAddonTokens(user.id, 'ch_full', 4900, 4900, 'pi_full');

    expect(await addonBalance(sql, user.id)).toBe(0);
    expect(await refundedCents(sql, purchaseId)).toBe(4900);

    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(1);
    expect(Number(txns[0].amount)).toBe(-5000);
    expect(Number(txns[0].balance_after)).toBe(0);
    expect(txns[0].transaction_type).toBe('adjustment');
    expect(txns[0].source).toBe('charge_refunded:ch_full');
    // Per-tranche idempotency key: chargeId suffixed with the cumulative amount (#8706).
    expect(txns[0].reference_id).toBe('ch_full:4900');
  });

  it('deducts proportionally (FLOOR of tokens × refund ratio) on a partial refund', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 5000 });
    const purchaseId = await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_half',
      tokens: 5000,
      amountCents: 4900,
    });

    // FLOOR(5000 × 2450/4900) = FLOOR(2500.0) = 2500
    await reverseAddonTokens(user.id, 'ch_half', 2450, 4900, 'pi_half');

    expect(await addonBalance(sql, user.id)).toBe(2500);
    expect(await refundedCents(sql, purchaseId)).toBe(2450);

    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(1);
    expect(Number(txns[0].amount)).toBe(-2500);
    expect(Number(txns[0].balance_after)).toBe(2500);
  });

  it('does not double-deduct when the identical refund webhook is re-fired (claim guard)', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 5000 });
    const purchaseId = await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_dup',
      tokens: 5000,
      amountCents: 4900,
    });

    await reverseAddonTokens(user.id, 'ch_dup', 4900, 4900, 'pi_dup');
    // Stripe at-least-once redelivery: the exact same event arrives again.
    await reverseAddonTokens(user.id, 'ch_dup', 4900, 4900, 'pi_dup');

    // refunded_cents(4900) < 4900 is false → claim matches 0 rows → whole CTE no-ops.
    expect(await addonBalance(sql, user.id)).toBe(0);
    expect(await refundedCents(sql, purchaseId)).toBe(4900);
    expect(await creditTxns(sql, user.id)).toHaveLength(1);
  });

  it('ignores an out-of-order lower-amount re-fire after a full refund', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 5000 });
    const purchaseId = await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_ooo',
      tokens: 5000,
      amountCents: 4900,
    });

    await reverseAddonTokens(user.id, 'ch_ooo', 4900, 4900, 'pi_ooo');
    // A stale/duplicate event carrying a smaller cumulative amount lands late.
    await reverseAddonTokens(user.id, 'ch_ooo', 2450, 4900, 'pi_ooo');

    // refunded_cents(4900) < 2450 is false → no further deduction.
    expect(await addonBalance(sql, user.id)).toBe(0);
    expect(await refundedCents(sql, purchaseId)).toBe(4900);
    expect(await creditTxns(sql, user.id)).toHaveLength(1);
  });

  it('claims refunded_cents but writes no audit row when the deduction rounds to 0', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 100 });
    const purchaseId = await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_tiny',
      tokens: 1,
      amountCents: 4900,
    });

    // FLOOR(1 × 1/4900) = 0 → tokens_to_deduct = 0 → audit + user UPDATE skipped,
    // but the claim itself still advances refunded_cents.
    await reverseAddonTokens(user.id, 'ch_tiny', 1, 4900, 'pi_tiny');

    expect(await addonBalance(sql, user.id)).toBe(100);
    expect(await refundedCents(sql, purchaseId)).toBe(1);
    expect(await creditTxns(sql, user.id)).toHaveLength(0);
  });

  it('clamps the deduction to the current addon balance when the user already spent some', async () => {
    const sql = harness().neonSql;
    // 5000 granted, 3000 already spent → only 2000 addon tokens remain.
    const user = await seedUser(sql, { addonTokens: 2000 });
    const purchaseId = await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_clamp',
      tokens: 5000,
      amountCents: 4900,
    });

    await reverseAddonTokens(user.id, 'ch_clamp', 4900, 4900, 'pi_clamp');

    // deduction = 5000, but amount is clamped to the available 2000 and addon floors at 0.
    expect(await addonBalance(sql, user.id)).toBe(0);
    expect(await refundedCents(sql, purchaseId)).toBe(4900);

    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(1);
    expect(Number(txns[0].amount)).toBe(-2000);
    expect(Number(txns[0].balance_after)).toBe(0);
  });

  it('claws back ALL tokens of a comped purchase (amount_cents=0 → NULLIF→LEAST(NULL,1)=1)', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 3000 });
    // A comped/promotional grant recorded as a zero-cost purchase row.
    const purchaseId = await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_comp',
      tokens: 3000,
      amountCents: 0,
    });

    await reverseAddonTokens(user.id, 'ch_comp', 1, 4900, 'pi_comp');

    // NULLIF(0,0)=NULL → (delta)::float/NULL = NULL → LEAST(NULL,1)=1 (Postgres
    // ignores NULL in LEAST) → FLOOR(3000 × 1)=3000 → full clawback, NOT a no-op.
    expect(await addonBalance(sql, user.id)).toBe(0);
    expect(await refundedCents(sql, purchaseId)).toBe(1);

    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(1);
    expect(Number(txns[0].amount)).toBe(-3000);
    expect(Number(txns[0].balance_after)).toBe(0);
  });

  it('records an incremental partial-then-cumulative refund without colliding on the idempotency index (#8706)', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 5000 });
    const purchaseId = await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_inc',
      tokens: 5000,
      amountCents: 4900,
    });

    // Stripe fires charge.refunded per refund with a STABLE charge.id and a
    // CUMULATIVE amount_refunded. First a 2450c (50%) partial...
    await reverseAddonTokens(user.id, 'ch_inc', 2450, 4900, 'pi_inc');
    expect(await addonBalance(sql, user.id)).toBe(2500);
    expect(await refundedCents(sql, purchaseId)).toBe(2450);

    // ...then the remainder, arriving as a cumulative 4900c on the SAME charge.
    // Pre-fix, this second clawback's audit INSERT collided on
    // idx_credit_txn_idempotent (reference_id = chargeId for both tranches),
    // rolled the whole CTE back, lost the deduction, and 500'd the webhook into
    // an infinite Stripe retry. The per-tranche refundRef makes the keys distinct.
    await reverseAddonTokens(user.id, 'ch_inc', 4900, 4900, 'pi_inc');

    expect(await addonBalance(sql, user.id)).toBe(0);
    expect(await refundedCents(sql, purchaseId)).toBe(4900);

    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(2);
    expect(txns.map((t) => Number(t.amount)).sort((a, b) => a - b)).toEqual([-2500, -2500]);
    // Distinct per-tranche reference_ids — the discriminator that avoids the collision.
    expect(txns.map((t) => t.reference_id).sort()).toEqual(['ch_inc:2450', 'ch_inc:4900']);
    // Both tranches share the stable, charge-scoped source.
    expect(new Set(txns.map((t) => t.source))).toEqual(new Set(['charge_refunded:ch_inc']));
  });

  it('deducts only the incremental delta when the purchase already carries a prior partial refund (refundedCents override)', async () => {
    const sql = harness().neonSql;
    // A 5000-token / 4900c purchase already 50%-refunded (refunded_cents=2450,
    // 2500 tokens already clawed back), plus 1500 addon tokens from elsewhere.
    const user = await seedUser(sql, { addonTokens: 4000 });
    const purchaseId = await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_delta',
      tokens: 5000,
      amountCents: 4900,
      refundedCents: 2450,
    });

    // The rest of the refund lands as a cumulative 4900c.
    await reverseAddonTokens(user.id, 'ch_delta', 4900, 4900, 'pi_delta');

    // Deduction is the DELTA, not the cumulative total:
    // FLOOR(5000 × (4900 − 2450)/4900) = FLOOR(2500) = 2500 (a mutant that used
    // the cumulative 4900 would deduct the full 4000 and floor addon to 0).
    expect(await addonBalance(sql, user.id)).toBe(1500);
    expect(await refundedCents(sql, purchaseId)).toBe(4900);

    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(1);
    expect(Number(txns[0].amount)).toBe(-2500);
    expect(txns[0].reference_id).toBe('ch_delta:4900');
  });

  it('does NOT deduct when the audit INSERT is swallowed by ON CONFLICT — no balance change without an audit row', async () => {
    // Regression for the deduct-without-audit divergence opened by the #8706
    // `ON CONFLICT (user_id, source, reference_id) DO NOTHING` backstop. The
    // precise-path final `UPDATE users` must depend on the `audit` CTE (mirroring
    // the fallback path), NOT on `deduction` alone. Otherwise, whenever the audit
    // INSERT conflicts with a pre-existing credit_transactions row carrying the
    // same (user, source, reference_id), the balance is still debited while NO
    // audit row is written — breaking the money-path invariant 'every balance
    // change has exactly one corresponding credit_transactions row'.
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 5000 });
    const purchaseId = await seedPurchase(sql, {
      userId: user.id,
      paymentIntent: 'pi_orphan',
      tokens: 5000,
      amountCents: 4900,
      // refunded_cents=0 so the claim guard PASSES (looks like a fresh 2450c
      // refund) even though an audit row for this exact tranche already exists.
      refundedCents: 0,
    });

    // Seed the EXACT (user, source, reference_id) the precise path will generate
    // for a 2450c refund of charge ch_orphan, so its audit INSERT conflicts on
    // idx_credit_txn_idempotent while the claim guard still admits the deduction.
    await sql`
      INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
      VALUES (${user.id}::uuid, 'adjustment', -2500, 2500, 'charge_refunded:ch_orphan', 'ch_orphan:2450')
    `;

    await reverseAddonTokens(user.id, 'ch_orphan', 2450, 4900, 'pi_orphan');

    // FIXED: audit INSERT conflicts → audit CTE empty → UPDATE suppressed →
    // addon balance is UNCHANGED. (Buggy SUT deducts to 2500 with no new row.)
    expect(await addonBalance(sql, user.id)).toBe(5000);
    // Exactly one audit row total — the pre-existing one. No silent second debit.
    expect(await creditTxns(sql, user.id)).toHaveLength(1);
    // The claim CTE reconciles refunded_cents to the already-recorded tranche;
    // the safety property is that this happens WITHOUT a balance change.
    expect(await refundedCents(sql, purchaseId)).toBe(2450);
  });

  it('falls back to the balance-based path when the paymentIntent matches no purchase', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 1000 });
    // No token_purchases row for this paymentIntent.

    await reverseAddonTokens(user.id, 'ch_fb', 500, 1000, 'pi_missing');

    // Fallback: refundRatio = 0.5 → deduct FLOOR(1000 × 0.5) = 500.
    expect(await addonBalance(sql, user.id)).toBe(500);

    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(1);
    expect(Number(txns[0].amount)).toBe(-500);
    expect(txns[0].source).toBe('charge_refunded:ch_fb');
    expect(txns[0].reference_id).toBe('ch_fb:500');
  });
});

describe('reverseAddonTokens — fallback balance-based path (no paymentIntent)', () => {
  it('deducts proportionally from the addon balance using the refund ratio', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 1000 });

    await reverseAddonTokens(user.id, 'ch_a', 500, 1000);

    expect(await addonBalance(sql, user.id)).toBe(500);
    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(1);
    expect(Number(txns[0].amount)).toBe(-500);
    expect(Number(txns[0].balance_after)).toBe(500);
  });

  it('clamps the refund ratio to 1 when the refund exceeds the charge total', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 1000 });

    // ratio = min(2000/1000, 1) = 1 → deduct all 1000 addon tokens.
    await reverseAddonTokens(user.id, 'ch_b', 2000, 1000);

    expect(await addonBalance(sql, user.id)).toBe(0);
    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(1);
    expect(Number(txns[0].amount)).toBe(-1000);
  });

  it('does not double-deduct on a re-fired charge (NOT EXISTS guard)', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 1000 });

    await reverseAddonTokens(user.id, 'ch_dup', 500, 1000);
    await reverseAddonTokens(user.id, 'ch_dup', 500, 1000);

    // Second call: a prior credit_transactions row with the same user/source/
    // reference_id exists → NOT EXISTS is false → audit inserts nothing → no UPDATE.
    expect(await addonBalance(sql, user.id)).toBe(500);
    expect(await creditTxns(sql, user.id)).toHaveLength(1);
  });

  it('escalates a cumulative refund to a full clawback via the stable base (#8706)', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 1000 });

    // First a 50% partial (no purchase row → fallback path).
    await reverseAddonTokens(user.id, 'ch_esc', 500, 1000);
    expect(await addonBalance(sql, user.id)).toBe(500);

    // The cumulative refund grows to 100%. The stable base reconstructed from the
    // first tranche (clawed 500 at 500c) is 1000, so the cumulative target is the
    // full 1000 and the second tranche deducts the remaining 500 delta.
    await reverseAddonTokens(user.id, 'ch_esc', 1000, 1000);

    expect(await addonBalance(sql, user.id)).toBe(0);
    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(2);
    expect(txns.map((t) => t.reference_id).sort()).toEqual(['ch_esc:1000', 'ch_esc:500']);
    // Each tranche deducts exactly its delta; the total equals the 1000-token grant.
    expect(txns.map((t) => Number(t.amount)).sort((a, b) => a - b)).toEqual([-500, -500]);
  });

  it('does NOT over-deduct on a non-terminal escalation: 50% then 75% nets to 75% (#8706)', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 1000 });

    // 50% partial → claw 500 (fallback path, no purchase row).
    await reverseAddonTokens(user.id, 'ch_step', 500, 1000);
    expect(await addonBalance(sql, user.id)).toBe(500);

    // Cumulative refund rises to 75%. The fair clawback for 75% of a 1000-token
    // grant is 750. The previous per-tranche code re-applied the ratio to the
    // SHRUNKEN current balance — 500 + floor(0.75 * 500) = 875 — over-charging the
    // customer by 125. The stable-base reconstruction deducts only the 250 delta
    // needed to reach the cumulative target of 750.
    await reverseAddonTokens(user.id, 'ch_step', 750, 1000);

    expect(await addonBalance(sql, user.id)).toBe(250);
    const txns = await creditTxns(sql, user.id);
    expect(txns).toHaveLength(2);
    const totalClawed = txns.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    expect(totalClawed).toBe(750);
    const second = txns.find((t) => t.reference_id === 'ch_step:750')!;
    expect(Number(second.amount)).toBe(-250);
  });

  it('never over-deducts when the user buys MORE addon tokens between tranches (stable base)', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 1000 });

    // 50% partial of a 1000-token grant → claw 500, leaving 500.
    await reverseAddonTokens(user.id, 'ch_buy', 500, 1000);
    expect(await addonBalance(sql, user.id)).toBe(500);

    // User buys a 1000-token addon pack between webhook deliveries → balance 1500.
    await sql`UPDATE users SET addon_tokens = 1500 WHERE id = ${user.id}`;

    // Cumulative refund rises to 75%. The clawback must target 75% of the ORIGINAL
    // 1000-token grant (750 total → +250 now), NOT 75% of the inflated 1500
    // balance. The freshly purchased tokens belong to the user and must survive.
    await reverseAddonTokens(user.id, 'ch_buy', 750, 1000);

    // 1500 − 250 = 1250: the 1000 newly bought tokens are fully preserved.
    expect(await addonBalance(sql, user.id)).toBe(1250);
    const txns = await creditTxns(sql, user.id);
    const second = txns.find((t) => t.reference_id === 'ch_buy:750')!;
    expect(Number(second.amount)).toBe(-250);
  });

  it('writes nothing when the user has no addon tokens to reverse', async () => {
    const sql = harness().neonSql;
    const user = await seedUser(sql, { addonTokens: 0 });

    await reverseAddonTokens(user.id, 'ch_z', 500, 1000);

    expect(await addonBalance(sql, user.id)).toBe(0);
    expect(await creditTxns(sql, user.id)).toHaveLength(0);
  });
});
