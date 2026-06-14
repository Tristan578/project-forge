// @vitest-environment node
/**
 * applyAdminTierChange — REAL Postgres behavioral tests (#8744).
 *
 * WHY THIS EXISTS
 * ---------------
 * The paid-only alpha comps a tester by setting their `tier` via the admin
 * endpoint. Before #8744 that wrote tier alone — no token grant — so a comped
 * "pro" user held 0 tokens and was blocked at every `/api/generate/*` route
 * (the core 5-10 min journey never starts). This handler closes that gap by
 * granting the tier's full monthly allocation + an audit row, atomically.
 *
 * Like the subscription-lifecycle real-DB suite, this runs the handler against
 * a real Postgres (PGlite, in-process, schema built by replaying the production
 * migrations) and asserts on the resulting `users` and `credit_transactions`
 * ROW STATE using the REAL `TIER_MONTHLY_TOKENS` — not interpolated-SQL
 * substrings, not a hand-copied allocation fixture. No production code import
 * changes: the SUT imports `@/lib/db/client`; we `vi.mock` only that module so
 * `getNeonSql()`/`getDb()`/`queryWithResilience()` resolve to the shared harness.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  createTestHarness,
  seedUser,
  getUserRow,
  type TestHarness,
  type QueryRow,
} from '@/lib/db/__tests__/pgliteHarness';

vi.mock('server-only', () => ({}));

const harnessRef = vi.hoisted(() => ({ current: null as unknown as TestHarness }));
function harness(): TestHarness {
  if (!harnessRef.current) throw new Error('harness not initialised');
  return harnessRef.current;
}

vi.mock('@/lib/db/client', () => ({
  getDb: () => harness().db,
  getNeonSql: () => harness().neonSql,
  queryWithResilience: (fn: () => Promise<unknown>) => fn(),
}));

// Real pricing, real schema, real drizzle-orm — NOT mocked. That is the point.
import { applyAdminTierChange } from '../admin-tier-grant';
import { TIER_MONTHLY_TOKENS } from '@/lib/tokens/pricing';

const num = (v: unknown): number => Number(v);

/** All credit_transactions for a user (order-independent; assert by source). */
async function txns(userId: string): Promise<QueryRow[]> {
  return harness().neonSql`
    SELECT transaction_type, amount, balance_after, source, reference_id
    FROM credit_transactions
    WHERE user_id = ${userId}::uuid
  `;
}

/** Find the single txn matching a source; fail loudly if absent/duplicated. */
function bySource(rows: QueryRow[], source: string): QueryRow {
  const matches = rows.filter((r) => r.source === source);
  expect(matches, `expected exactly one txn with source "${source}"`).toHaveLength(1);
  return matches[0];
}

/**
 * Find the single audit row for a source AND assert the two invariants that hold
 * for EVERY grant code path: the row is an 'adjustment' (the literal lives in the
 * SQL template, not a bound param, so only a real-DB assertion can reach it), and
 * its reference_id is non-null (the partial unique idempotency index fires only
 * WHERE reference_id IS NOT NULL — a null would silently disarm it). Returns the
 * row for source-specific amount/balance_after assertions.
 */
function expectAdjustment(rows: QueryRow[], source: string): QueryRow {
  const audit = bySource(rows, source);
  expect(audit.transaction_type).toBe('adjustment');
  expect(audit.reference_id).not.toBeNull();
  return audit;
}

describe('applyAdminTierChange — real Postgres (#8744)', () => {
  beforeAll(async () => {
    harnessRef.current = await createTestHarness();
  });
  afterAll(async () => {
    await harness().close();
  });
  beforeEach(async () => {
    await harness().truncateAll();
  });

  it('grants the new tier allocation to a comped-from-zero user and writes one audit row', async () => {
    // The exact gap #8744 fixes: a freshly-approved tester with 0 tokens.
    const seeded = await seedUser(harness().neonSql, {
      tier: 'starter',
      monthlyTokens: 0,
      monthlyTokensUsed: 0,
      addonTokens: 0,
      earnedCredits: 0,
    });

    await applyAdminTierChange(seeded.id, 'pro', {
      previousTier: 'starter',
      grantedByClerkId: 'clerk_admin',
    });

    const row = await getUserRow(harness().neonSql, seeded.id);
    expect(row!.tier).toBe('pro');
    expect(num(row!.monthly_tokens)).toBe(TIER_MONTHLY_TOKENS.pro);
    expect(num(row!.monthly_tokens_used)).toBe(0);
    expect(row!.billing_cycle_start).not.toBeNull();

    // Spendable balance is now the full pro allotment — the journey can start.
    const balance =
      Math.max(0, num(row!.monthly_tokens) - num(row!.monthly_tokens_used)) +
      num(row!.addon_tokens) +
      num(row!.earned_credits);
    expect(balance).toBe(TIER_MONTHLY_TOKENS.pro);

    const rows = await txns(seeded.id);
    const audit = expectAdjustment(rows, 'admin_tier_change:starter->pro');
    expect(num(audit.amount)).toBe(TIER_MONTHLY_TOKENS.pro);
    expect(num(audit.balance_after)).toBe(TIER_MONTHLY_TOKENS.pro);
  });

  it('computes balance_after from live addon + earned credits at execution time', async () => {
    const seeded = await seedUser(harness().neonSql, {
      tier: 'starter',
      monthlyTokens: 0,
      addonTokens: 200,
      earnedCredits: 50,
    });

    await applyAdminTierChange(seeded.id, 'creator', {
      previousTier: 'starter',
      grantedByClerkId: 'clerk_admin',
    });

    const rows = await txns(seeded.id);
    const audit = expectAdjustment(rows, 'admin_tier_change:starter->creator');
    // allocation + addon + earned = 1000 + 200 + 50
    expect(num(audit.balance_after)).toBe(TIER_MONTHLY_TOKENS.creator + 200 + 50);

    const row = await getUserRow(harness().neonSql, seeded.id);
    expect(num(row!.addon_tokens)).toBe(200); // addon untouched by a tier grant
    expect(num(row!.earned_credits)).toBe(50);
  });

  it('absolute-sets the allocation (does not stack) when re-comping an already-granted user', async () => {
    const seeded = await seedUser(harness().neonSql, {
      tier: 'pro',
      monthlyTokens: TIER_MONTHLY_TOKENS.pro,
      monthlyTokensUsed: 1200, // user has spent some
    });

    // Admin downgrades then the journey continues at the new tier's full amount.
    await applyAdminTierChange(seeded.id, 'creator', {
      previousTier: 'pro',
      grantedByClerkId: 'clerk_admin',
    });

    const row = await getUserRow(harness().neonSql, seeded.id);
    expect(row!.tier).toBe('creator');
    expect(num(row!.monthly_tokens)).toBe(TIER_MONTHLY_TOKENS.creator); // absolute, not +=
    expect(num(row!.monthly_tokens_used)).toBe(0); // cycle reset

    const audit = expectAdjustment(await txns(seeded.id), 'admin_tier_change:pro->creator');
    expect(num(audit.amount)).toBe(TIER_MONTHLY_TOKENS.creator);
  });

  it('folds banned:true into the same atomic write', async () => {
    const seeded = await seedUser(harness().neonSql, { tier: 'starter', monthlyTokens: 0 });

    await applyAdminTierChange(seeded.id, 'pro', {
      previousTier: 'starter',
      grantedByClerkId: 'clerk_admin',
      banned: true,
    });

    const row = await getUserRow(harness().neonSql, seeded.id);
    expect(num(row!.banned)).toBe(1);
    expect(row!.tier).toBe('pro');
    expect(num(row!.monthly_tokens)).toBe(TIER_MONTHLY_TOKENS.pro);

    // The grant + audit row are written even when the ban flag rides along.
    expectAdjustment(await txns(seeded.id), 'admin_tier_change:starter->pro');
  });

  it('preserves the existing banned value when the option is omitted', async () => {
    const seeded = await seedUser(harness().neonSql, { tier: 'starter', monthlyTokens: 0 });
    // Seed a banned user directly (seedUser has no banned override).
    await harness().neonSql`UPDATE users SET banned = 1 WHERE id = ${seeded.id}::uuid`;

    await applyAdminTierChange(seeded.id, 'hobbyist', {
      previousTier: 'starter',
      grantedByClerkId: 'clerk_admin',
    });

    const row = await getUserRow(harness().neonSql, seeded.id);
    expect(num(row!.banned)).toBe(1); // unchanged — COALESCE(NULL, banned)
    expect(row!.tier).toBe('hobbyist');
  });

  it('clears banned with banned:false while granting the tier', async () => {
    const seeded = await seedUser(harness().neonSql, { tier: 'starter', monthlyTokens: 0 });
    await harness().neonSql`UPDATE users SET banned = 1 WHERE id = ${seeded.id}::uuid`;

    await applyAdminTierChange(seeded.id, 'pro', {
      previousTier: 'starter',
      grantedByClerkId: 'clerk_admin',
      banned: false,
    });

    const row = await getUserRow(harness().neonSql, seeded.id);
    expect(num(row!.banned)).toBe(0);
    expect(row!.tier).toBe('pro');
  });

  it('records a distinct audit row for each admin change (not idempotency-collapsed)', async () => {
    const seeded = await seedUser(harness().neonSql, { tier: 'starter', monthlyTokens: 0 });

    await applyAdminTierChange(seeded.id, 'pro', {
      previousTier: 'starter',
      grantedByClerkId: 'clerk_admin',
    });
    await applyAdminTierChange(seeded.id, 'starter', {
      previousTier: 'pro',
      grantedByClerkId: 'clerk_admin',
    });
    await applyAdminTierChange(seeded.id, 'pro', {
      previousTier: 'starter',
      grantedByClerkId: 'clerk_admin',
    });

    const rows = await txns(seeded.id);
    // Two starter->pro grants + one pro->starter grant = three distinct rows.
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.source === 'admin_tier_change:starter->pro')).toHaveLength(2);
    expect(rows.filter((r) => r.source === 'admin_tier_change:pro->starter')).toHaveLength(1);
    // Every row is an adjustment with a non-null reference_id — a null would
    // silently disarm the partial unique idempotency index (WHERE reference_id
    // IS NOT NULL), so distinct intentional grants must each carry one.
    rows.forEach((r) => {
      expect(r.transaction_type).toBe('adjustment');
      expect(r.reference_id).not.toBeNull();
    });

    const row = await getUserRow(harness().neonSql, seeded.id);
    expect(row!.tier).toBe('pro');
    expect(num(row!.monthly_tokens)).toBe(TIER_MONTHLY_TOKENS.pro);
  });
});
