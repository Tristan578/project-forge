// @vitest-environment node
/**
 * Subscription lifecycle — REAL Postgres behavioral tests (F19, #8611).
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * The previous version of this file was named `*.db.test.ts` but was a pure
 * mock: it asserted on `transactionStatementCount()` (how many statements a
 * neon transaction batched) and `neonCallValues(n).toContain(...)` (which JS
 * values were interpolated into the tagged template — e.g. `.toContain('hobbyist')`,
 * `.toContain(300)`). Those assertions prove the SQL *string* was assembled a
 * certain way; they prove NOTHING about what the SQL actually does to the rows.
 * A handler could interpolate every "correct" value and still grant the wrong
 * amount, skip the idempotency arbiter, or double-credit on webhook redelivery —
 * and every one of those mock assertions would still pass. It also mocked
 * `@/lib/tokens/pricing` with hand-copied allocations, so a drift between the
 * fixture and the real table would go uncaught.
 *
 * This version runs each handler against a real Postgres 17 (PGlite, in-process)
 * built by replaying the production migrations, and asserts on the resulting
 * `users` and `credit_transactions` ROW STATE. It uses the REAL
 * `TIER_MONTHLY_TOKENS`, so allocation assertions are pinned to production
 * values, not a fixture. No production code imports change — the SUT still
 * imports `@/lib/db/client`; we `vi.mock` only that module so `getDb()`,
 * `getNeonSql()`, and `queryWithResilience()` resolve to the shared harness.
 *
 * IDEMPOTENCY IS PROVEN BY SEQUENTIAL RE-FIRE — the exact shape Stripe's
 * at-least-once webhook redelivery produces — not by inspecting the query for a
 * "NOT EXISTS"/"ON CONFLICT" substring. Re-firing `invoice.paid` is what
 * surfaced the rollover double-credit money bug fixed alongside this conversion
 * (see the `invoice.paid → renewal` redelivery test).
 *
 * Ordering note: every statement in a `neonSql.transaction([...])` shares one
 * transaction-start `now()`, so `created_at` is identical across the batch and
 * row order is not deterministic. Assertions therefore locate rows by `source`
 * and assert on counts, never on positional order.
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

// Single harness shared across the file; `getDb()`/`getNeonSql()` resolve here.
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
import {
  findUserByStripeCustomer,
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
} from '../subscription-lifecycle';
import { TIER_MONTHLY_TOKENS } from '@/lib/tokens/pricing';

// ───────────────────────── read helpers ─────────────────────────
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

describe('subscription lifecycle — real Postgres (F19, #8611)', () => {
  beforeAll(async () => {
    harnessRef.current = await createTestHarness();
  });
  afterAll(async () => {
    await harness().close();
  });
  beforeEach(async () => {
    await harness().truncateAll();
  });

  // ───────────────────────── findUserByStripeCustomer ─────────────────────────
  describe('findUserByStripeCustomer', () => {
    it('returns the user when the stripe_customer_id matches', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_match',
        tier: 'creator',
      });

      const user = await findUserByStripeCustomer('cus_match');

      expect(user).not.toBeNull();
      expect(user!.id).toBe(seeded.id);
      expect(user!.tier).toBe('creator');
      // Full-row select must include `banned` — a column declared in schema.ts
      // but created by no migration (the auth-path drift tracked in #8707). The
      // harness reconciliation makes this select succeed; without it the entire
      // auth path throws `column "banned" does not exist` on a migration-only DB.
      expect(num(user!.banned)).toBe(0);
    });

    it('returns null when no user has that customer id', async () => {
      await seedUser(harness().neonSql, { stripeCustomerId: 'cus_someone_else' });

      const user = await findUserByStripeCustomer('cus_nobody');

      expect(user).toBeNull();
    });
  });

  // ───────────────────────── subscription.created ─────────────────────────
  describe('handleSubscriptionCreated', () => {
    it('grants the tier allocation, sets sub id, and writes one audit row', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'starter',
        monthlyTokens: 0,
        monthlyTokensUsed: 0,
        addonTokens: 200,
        earnedCredits: 50,
      });

      await handleSubscriptionCreated('cus_a', 'sub_1', 'hobbyist');

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      expect(row.tier).toBe('hobbyist');
      expect(num(row.monthly_tokens)).toBe(TIER_MONTHLY_TOKENS.hobbyist); // 300
      expect(num(row.monthly_tokens_used)).toBe(0);
      expect(row.stripe_subscription_id).toBe('sub_1');
      expect(num(row.addon_tokens)).toBe(200); // addon preserved

      const all = await txns(seeded.id);
      expect(all).toHaveLength(1);
      const grant = bySource(all, 'subscription_created:hobbyist');
      expect(grant.transaction_type).toBe('monthly_grant');
      expect(num(grant.amount)).toBe(300);
      // balance_after = allocation + addon + earned = 300 + 200 + 50
      expect(num(grant.balance_after)).toBe(550);
      expect(grant.reference_id).toBe('sub_1');
    });

    it('is a no-op when no user matches the customer', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'starter',
        monthlyTokens: 0,
      });

      await handleSubscriptionCreated('cus_missing', 'sub_x', 'pro');

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      expect(row.tier).toBe('starter');
      expect(num(row.monthly_tokens)).toBe(0);
      expect(row.stripe_subscription_id).toBeNull();
      expect(await txns(seeded.id)).toHaveLength(0);
    });

    it('is idempotent on webhook redelivery (one audit row, fixed allocation)', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'starter',
        addonTokens: 200,
      });

      await handleSubscriptionCreated('cus_a', 'sub_1', 'hobbyist');
      await handleSubscriptionCreated('cus_a', 'sub_1', 'hobbyist'); // redelivery

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      // The grant UPDATE sets monthly_tokens to a FIXED allocation (not a relative
      // increment), so re-running it cannot inflate the balance...
      expect(num(row.monthly_tokens)).toBe(300);
      expect(num(row.addon_tokens)).toBe(200);
      // ...and the audit INSERT's ON CONFLICT arbiter keeps exactly one row.
      expect(await txns(seeded.id)).toHaveLength(1);
    });

    it('redelivery after interleaved spend does NOT re-zero monthly_tokens_used (#8711)', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'starter',
        monthlyTokens: 0,
        monthlyTokensUsed: 0,
        addonTokens: 0,
        stripeSubscriptionId: null,
      });

      // First create: grants 300 hobbyist tokens, resets the cycle.
      await handleSubscriptionCreated('cus_a', 'sub_1', 'hobbyist');

      // The user spends 120 of the freshly-granted allocation BEFORE Stripe
      // redelivers the same subscription.created (at-least-once). The
      // immediate-refire test above cannot exercise this: there used is still 0
      // when the duplicate lands, so a re-run of the reset is invisible.
      await harness().neonSql`
        UPDATE users SET monthly_tokens_used = 120 WHERE id = ${seeded.id}::uuid
      `;

      await handleSubscriptionCreated('cus_a', 'sub_1', 'hobbyist'); // redelivery

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      // The reset must be a no-op now — re-zeroing monthly_tokens_used here
      // silently refunds the 120 already-spent tokens, letting the user spend
      // the monthly allocation twice for the price of a webhook retry.
      expect(num(row.monthly_tokens_used)).toBe(120); // preserved, NOT reset to 0
      expect(num(row.monthly_tokens)).toBe(300);
      expect(await txns(seeded.id)).toHaveLength(1); // one grant audit row
    });
  });

  // ───────────────────────── subscription.updated ─────────────────────────
  describe('handleSubscriptionUpdated', () => {
    it('updates only the sub id when the tier is unchanged (status churn)', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'hobbyist',
        monthlyTokens: 300,
        monthlyTokensUsed: 100,
        addonTokens: 200,
        stripeSubscriptionId: 'sub_old',
      });

      await handleSubscriptionUpdated('cus_a', 'sub_new', 'hobbyist', 'active');

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      expect(row.tier).toBe('hobbyist');
      expect(row.stripe_subscription_id).toBe('sub_new');
      // No token reset on a same-tier update.
      expect(num(row.monthly_tokens)).toBe(300);
      expect(num(row.monthly_tokens_used)).toBe(100);
      expect(await txns(seeded.id)).toHaveLength(0);
    });

    it.each(['past_due', 'unpaid'])(
      'on %s status: updates sub id only, leaves tier and tokens untouched',
      async (status) => {
        const seeded = await seedUser(harness().neonSql, {
          stripeCustomerId: 'cus_a',
          tier: 'creator',
          monthlyTokens: 1000,
          monthlyTokensUsed: 400,
          stripeSubscriptionId: 'sub_old',
        });

        // newTier=pro would normally grant tokens, but a delinquent status must
        // short-circuit before any token mutation (grace period is handled by
        // invoice.payment_failed instead).
        await handleSubscriptionUpdated('cus_a', 'sub_new', 'pro', status);

        const row = (await getUserRow(harness().neonSql, seeded.id))!;
        expect(row.stripe_subscription_id).toBe('sub_new');
        expect(row.tier).toBe('creator'); // unchanged
        expect(num(row.monthly_tokens)).toBe(1000);
        expect(num(row.monthly_tokens_used)).toBe(400);
        expect(await txns(seeded.id)).toHaveLength(0);
      }
    );

    it('on upgrade: grants the allocation difference and resets the used counter', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'hobbyist',
        monthlyTokens: 300,
        monthlyTokensUsed: 100,
        addonTokens: 200,
        earnedCredits: 0,
        stripeSubscriptionId: 'sub_1',
      });

      await handleSubscriptionUpdated('cus_a', 'sub_1', 'creator', 'active');

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      expect(row.tier).toBe('creator');
      // monthly_tokens = GREATEST(0, 300-100) + (1000-300) = 200 + 700 = 900
      expect(num(row.monthly_tokens)).toBe(900);
      expect(num(row.monthly_tokens_used)).toBe(0);
      expect(num(row.addon_tokens)).toBe(200);

      const all = await txns(seeded.id);
      expect(all).toHaveLength(1);
      const adj = bySource(all, 'upgrade:hobbyist->creator');
      expect(adj.transaction_type).toBe('adjustment');
      expect(num(adj.amount)).toBe(700); // the difference
      // balance_after = new remaining (900) + addon (200) + earned (0)
      expect(num(adj.balance_after)).toBe(1100);
      expect(adj.reference_id).toBe('sub_1');
    });

    it('on downgrade: caps monthly tokens to the new allocation, records a negative adjustment', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'creator',
        monthlyTokens: 1000,
        monthlyTokensUsed: 400,
        addonTokens: 200,
        earnedCredits: 0,
        stripeSubscriptionId: 'sub_1',
      });

      await handleSubscriptionUpdated('cus_a', 'sub_1', 'hobbyist', 'active');

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      expect(row.tier).toBe('hobbyist');
      expect(num(row.monthly_tokens)).toBe(300); // capped to new allocation
      expect(num(row.monthly_tokens_used)).toBe(0);
      expect(num(row.addon_tokens)).toBe(200); // addon preserved

      const all = await txns(seeded.id);
      expect(all).toHaveLength(1);
      const adj = bySource(all, 'downgrade:creator->hobbyist');
      expect(adj.transaction_type).toBe('adjustment');
      expect(num(adj.amount)).toBe(-700); // newAllocation - oldAllocation
      // balance_after = newAllocation (300) + addon (200) + earned (0)
      expect(num(adj.balance_after)).toBe(500);
    });

    it('is a no-op when no user matches the customer', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'hobbyist',
        monthlyTokens: 300,
      });

      await handleSubscriptionUpdated('cus_gone', 'sub_x', 'pro', 'active');

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      expect(row.tier).toBe('hobbyist');
      expect(num(row.monthly_tokens)).toBe(300);
      expect(await txns(seeded.id)).toHaveLength(0);
    });

    it('upgrade is idempotent on redelivery (tier state guards the second fire)', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'hobbyist',
        monthlyTokens: 300,
        monthlyTokensUsed: 100,
        addonTokens: 200,
        stripeSubscriptionId: 'sub_1',
      });

      await handleSubscriptionUpdated('cus_a', 'sub_1', 'creator', 'active');
      // Redelivery: tier is now persisted as 'creator', so the second event sees
      // no tier change and skips token logic entirely (no double-grant).
      await handleSubscriptionUpdated('cus_a', 'sub_1', 'creator', 'active');

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      expect(num(row.monthly_tokens)).toBe(900); // NOT 1600
      expect(num(row.addon_tokens)).toBe(200);
      expect(await txns(seeded.id)).toHaveLength(1);
    });
  });

  // ───────────────────────── subscription.deleted ─────────────────────────
  describe('handleSubscriptionDeleted', () => {
    it('reverts to starter, clears the sub id, preserves addon, records the lost monthly balance', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'creator',
        monthlyTokens: 1000,
        monthlyTokensUsed: 400,
        addonTokens: 200,
        earnedCredits: 0,
        stripeSubscriptionId: 'sub_1',
        activeFeatures: ['ai_generation', 'mcp_access', 'publish_games'],
      });

      await handleSubscriptionDeleted('cus_a', 'sub_1');

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      expect(row.tier).toBe('starter');
      expect(num(row.monthly_tokens)).toBe(TIER_MONTHLY_TOKENS.starter); // 50
      expect(num(row.monthly_tokens_used)).toBe(0);
      expect(row.stripe_subscription_id).toBeNull();
      expect(num(row.addon_tokens)).toBe(200); // addon preserved
      // Stripe entitlements are cleared on cancel so capability gating falls
      // back to the (now starter) tier instead of granting stale paid features
      // until the next entitlement event arrives (#8831).
      expect(row.active_features).toBeNull();

      const all = await txns(seeded.id);
      expect(all).toHaveLength(1);
      const adj = bySource(all, 'cancellation:creator->starter');
      expect(adj.transaction_type).toBe('adjustment');
      // INSERT runs BEFORE the UPDATE, so it reads pre-cancellation remaining:
      // -GREATEST(0, 1000-400) = -600
      expect(num(adj.amount)).toBe(-600);
      // balance_after = starter allocation (50) + addon (200) + earned (0)
      expect(num(adj.balance_after)).toBe(250);
      expect(adj.reference_id).toBe('sub_1');
    });

    it('is a no-op when no user matches the customer', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'creator',
        monthlyTokens: 1000,
        stripeSubscriptionId: 'sub_1',
      });

      await handleSubscriptionDeleted('cus_gone', 'sub_1');

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      expect(row.tier).toBe('creator');
      expect(row.stripe_subscription_id).toBe('sub_1');
      expect(await txns(seeded.id)).toHaveLength(0);
    });

    it('redelivery does not re-credit or re-deduct the balance', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'creator',
        monthlyTokens: 1000,
        monthlyTokensUsed: 400,
        addonTokens: 200,
        stripeSubscriptionId: 'sub_1',
      });

      await handleSubscriptionDeleted('cus_a', 'sub_1');
      await handleSubscriptionDeleted('cus_a', 'sub_1'); // redelivery

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      // Balance is idempotent: fixed-value UPDATE + addon untouched.
      expect(row.tier).toBe('starter');
      expect(num(row.monthly_tokens)).toBe(50);
      expect(num(row.addon_tokens)).toBe(200);
      // The genuine transition is recorded exactly once (ON CONFLICT arbiter)...
      const all = await txns(seeded.id);
      expect(all.filter((r) => r.source === 'cancellation:creator->starter')).toHaveLength(1);
      // ...and NO second cancellation row is written. previousTier is read at
      // processing time, so the redelivery sees tier='starter' and would compute
      // a DIFFERENT source ('cancellation:starter->starter') that the per-source
      // ON CONFLICT cannot suppress. Assert the total cancellation count, not
      // just the first source, or the bogus duplicate slips through (#8712).
      expect(all.filter((r) => String(r.source).startsWith('cancellation:'))).toHaveLength(1);
    });

    it('redelivery after interleaved starter spend does NOT re-zero used or write a duplicate audit row (#8712)', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'creator',
        monthlyTokens: 1000,
        monthlyTokensUsed: 400,
        addonTokens: 200,
        earnedCredits: 0,
        stripeSubscriptionId: 'sub_1',
      });

      await handleSubscriptionDeleted('cus_a', 'sub_1');

      // After cancellation the user is on starter (50 tokens). They spend 30
      // before Stripe redelivers subscription.deleted (at-least-once). The
      // immediate-refire test above cannot catch this: used is 0 at re-fire, so
      // the unconditional reset's re-zero is invisible.
      await harness().neonSql`
        UPDATE users SET monthly_tokens_used = 30 WHERE id = ${seeded.id}::uuid
      `;

      await handleSubscriptionDeleted('cus_a', 'sub_1'); // redelivery

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      // The reset must be a no-op now — re-zeroing here refunds the 30 spent
      // starter tokens.
      expect(num(row.monthly_tokens_used)).toBe(30); // preserved, NOT reset to 0
      expect(num(row.monthly_tokens)).toBe(50);
      expect(num(row.addon_tokens)).toBe(200);

      const all = await txns(seeded.id);
      // Exactly ONE cancellation row total — the redelivery must not write a
      // second 'cancellation:starter->starter' row (previousTier mutates).
      expect(all.filter((r) => String(r.source).startsWith('cancellation:'))).toHaveLength(1);
      expect(all.filter((r) => r.source === 'cancellation:creator->starter')).toHaveLength(1);
    });
  });

  // ───────────────────────── invoice.paid (renewal) ─────────────────────────
  describe('handleInvoicePaid', () => {
    it('is a no-op when the subscription id is null', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'hobbyist',
        monthlyTokens: 300,
        monthlyTokensUsed: 100,
      });

      await handleInvoicePaid('cus_a', 'inv_1', null);

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      expect(num(row.monthly_tokens)).toBe(300);
      expect(num(row.monthly_tokens_used)).toBe(100);
      expect(await txns(seeded.id)).toHaveLength(0);
    });

    it('is a no-op when no user matches the customer', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'hobbyist',
        monthlyTokens: 300,
        stripeSubscriptionId: 'sub_x',
      });

      await handleInvoicePaid('cus_gone', 'inv_1', 'sub_x');

      expect(await txns(seeded.id)).toHaveLength(0);
    });

    it('skips when the invoice subscription id does not match the user record (stale event)', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'hobbyist',
        monthlyTokens: 300,
        monthlyTokensUsed: 100,
        addonTokens: 200,
        stripeSubscriptionId: 'sub_current',
      });

      await handleInvoicePaid('cus_a', 'inv_1', 'sub_other');

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      expect(num(row.monthly_tokens)).toBe(300);
      expect(num(row.monthly_tokens_used)).toBe(100);
      expect(num(row.addon_tokens)).toBe(200);
      expect(await txns(seeded.id)).toHaveLength(0);
    });

    it('rolls unused monthly tokens into addon, resets the cycle, and grants the new allocation', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'hobbyist',
        monthlyTokens: 300,
        monthlyTokensUsed: 100, // 200 unused → rolls over
        addonTokens: 200,
        earnedCredits: 0,
        stripeSubscriptionId: 'sub_x',
      });

      await handleInvoicePaid('cus_a', 'inv_1', 'sub_x');

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      // addon += LEAST(remaining 200, allocation 300) = 200 → 400
      expect(num(row.addon_tokens)).toBe(400);
      expect(num(row.monthly_tokens)).toBe(300); // reset to allocation
      expect(num(row.monthly_tokens_used)).toBe(0);

      const all = await txns(seeded.id);
      expect(all).toHaveLength(2);
      const rollover = bySource(all, 'renewal_rollover:hobbyist');
      expect(rollover.transaction_type).toBe('rollover');
      expect(num(rollover.amount)).toBe(200);
      // balance_after reads pre-rollover addon: 200(remaining)+200(addon)+0(earned)+200(rollover)
      expect(num(rollover.balance_after)).toBe(600);
      expect(rollover.reference_id).toBe('inv_1');
      const grant = bySource(all, 'renewal:hobbyist');
      expect(grant.transaction_type).toBe('monthly_grant');
      expect(num(grant.amount)).toBe(300);
      // grant balance_after reads addon AFTER rollover: 300+400+0
      expect(num(grant.balance_after)).toBe(700);
    });

    it('skips rollover when no monthly tokens remain (per-tier allocation)', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'creator',
        monthlyTokens: 1000,
        monthlyTokensUsed: 1000, // nothing left to roll over
        addonTokens: 200,
        earnedCredits: 0,
        stripeSubscriptionId: 'sub_x',
      });

      await handleInvoicePaid('cus_a', 'inv_1', 'sub_x');

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      expect(num(row.addon_tokens)).toBe(200); // unchanged — no rollover
      expect(num(row.monthly_tokens)).toBe(TIER_MONTHLY_TOKENS.creator); // 1000
      expect(num(row.monthly_tokens_used)).toBe(0);

      const all = await txns(seeded.id);
      expect(all).toHaveLength(1);
      const grant = bySource(all, 'renewal:creator');
      expect(num(grant.amount)).toBe(1000);
      expect(num(grant.balance_after)).toBe(1200); // 1000 + 200 + 0
    });

    it('proceeds when the user has no recorded sub id yet (first invoice)', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'hobbyist',
        monthlyTokens: 300,
        monthlyTokensUsed: 300, // no rollover, keep it simple
        addonTokens: 0,
        stripeSubscriptionId: null,
      });

      await handleInvoicePaid('cus_a', 'inv_1', 'sub_x');

      const all = await txns(seeded.id);
      expect(all).toHaveLength(1);
      expect(num(bySource(all, 'renewal:hobbyist').amount)).toBe(300);
    });

    it('is idempotent on webhook redelivery — no double rollover credit (#8708)', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'hobbyist',
        monthlyTokens: 300,
        monthlyTokensUsed: 100,
        addonTokens: 200,
        earnedCredits: 0,
        stripeSubscriptionId: 'sub_x',
      });

      await handleInvoicePaid('cus_a', 'inv_1', 'sub_x');
      // Stripe redelivers the SAME invoice (at-least-once). Without an idempotent
      // rollover the second fire re-rolls the freshly-granted 300 monthly tokens
      // into addon, permanently inflating the purchased-token balance.
      await handleInvoicePaid('cus_a', 'inv_1', 'sub_x');

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      // addon must stay at the single-fire result, NOT grow on redelivery.
      expect(num(row.addon_tokens)).toBe(400);
      expect(num(row.monthly_tokens)).toBe(300);
      expect(num(row.monthly_tokens_used)).toBe(0);
      // Audit rows are deduplicated by the ON CONFLICT arbiter.
      const all = await txns(seeded.id);
      expect(all.filter((r) => r.source === 'renewal_rollover:hobbyist')).toHaveLength(1);
      expect(all.filter((r) => r.source === 'renewal:hobbyist')).toHaveLength(1);
    });

    it('redelivery after interleaved spend does NOT re-zero monthly_tokens_used (#8611)', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'hobbyist',
        monthlyTokens: 300,
        monthlyTokensUsed: 100, // 200 unused → rolls over on the first fire
        addonTokens: 200,
        earnedCredits: 0,
        stripeSubscriptionId: 'sub_x',
      });

      // First renewal: rolls 200 → addon (200 → 400), resets the cycle, grants 300.
      await handleInvoicePaid('cus_a', 'inv_1', 'sub_x');

      // The user spends 150 of the freshly-granted monthly allocation BEFORE
      // Stripe redelivers the same invoice. This is the case the immediate
      // re-fire test above cannot exercise: there the used-counter is still 0
      // when the duplicate lands, so a re-run of the reset is invisible.
      await harness().neonSql`
        UPDATE users SET monthly_tokens_used = 150 WHERE id = ${seeded.id}::uuid
      `;

      // Stripe redelivers invoice.paid (at-least-once). The reset must be a
      // no-op now — re-zeroing monthly_tokens_used here silently refunds the
      // 150 already-spent tokens, letting the user spend the monthly allocation
      // twice per cycle for the price of a webhook retry.
      await handleInvoicePaid('cus_a', 'inv_1', 'sub_x');

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      expect(num(row.monthly_tokens_used)).toBe(150); // preserved, NOT reset to 0
      expect(num(row.monthly_tokens)).toBe(300);
      expect(num(row.addon_tokens)).toBe(400); // no second rollover (#8708)

      // The renewal is still recorded exactly once on each axis.
      const all = await txns(seeded.id);
      expect(all.filter((r) => r.source === 'renewal:hobbyist')).toHaveLength(1);
      expect(all.filter((r) => r.source === 'renewal_rollover:hobbyist')).toHaveLength(1);
    });

    it('redelivery after a no-rollover first fire does NOT credit a bogus rollover (#8709)', async () => {
      // The leak the #8708 fix above does NOT close. When the FIRST fire has no
      // monthly tokens left (remaining == 0), the rollover statement is skipped
      // entirely, so no `renewal_rollover` anchor row is ever written — yet the
      // reset and grant still run, marking the invoice processed via `renewal:tier`.
      // The user then spends part of the freshly-granted allocation and Stripe
      // redelivers the same invoice (at-least-once). The handler's pre-read now
      // sees remaining > 0 (used was reset to 0, only part re-spent), turns the
      // rollover statement back ON, finds no `renewal_rollover` anchor to suppress
      // it, and credits a free rollover into the non-expiring addon balance — a
      // pure money leak gated only on the *conditionally-written* rollover anchor,
      // not on the always-written per-invoice `renewal:tier` marker.
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'creator',
        monthlyTokens: 1000,
        monthlyTokensUsed: 1000, // remaining == 0 → NO rollover on the first fire
        addonTokens: 0,
        earnedCredits: 0,
        stripeSubscriptionId: 'sub_x',
      });

      // First fire: no rollover (nothing to roll), reset the cycle, grant 1000.
      await handleInvoicePaid('cus_a', 'inv_1', 'sub_x');

      const afterFirst = (await getUserRow(harness().neonSql, seeded.id))!;
      expect(num(afterFirst.addon_tokens)).toBe(0); // no rollover credit
      expect(num(afterFirst.monthly_tokens_used)).toBe(0); // reset
      const firstTxns = await txns(seeded.id);
      expect(firstTxns.filter((r) => r.source === 'renewal_rollover:creator')).toHaveLength(0);
      expect(firstTxns.filter((r) => r.source === 'renewal:creator')).toHaveLength(1);

      // User spends 400 of the fresh 1000-token allocation → remaining 600.
      await harness().neonSql`
        UPDATE users SET monthly_tokens_used = 400 WHERE id = ${seeded.id}::uuid
      `;

      // Stripe redelivers the SAME invoice. A fresh read now shows remaining 600,
      // so a leaky handler re-enables the rollover and credits +600 to addon.
      await handleInvoicePaid('cus_a', 'inv_1', 'sub_x');

      const afterRedeliver = (await getUserRow(harness().neonSql, seeded.id))!;
      // Rollover must stay gated on the per-invoice renewal-grant anchor: a
      // redelivery cannot create one, even when the fresh read shows remaining > 0.
      expect(num(afterRedeliver.addon_tokens)).toBe(0); // NO bogus rollover credit
      expect(num(afterRedeliver.monthly_tokens_used)).toBe(400); // spend preserved (#8611)
      expect(num(afterRedeliver.monthly_tokens)).toBe(1000);

      const all = await txns(seeded.id);
      expect(all.filter((r) => r.source === 'renewal_rollover:creator')).toHaveLength(0);
      expect(all.filter((r) => r.source === 'renewal:creator')).toHaveLength(1);
    });

    it('cross-tier redelivery is idempotent — a tier change between deliveries cannot defeat the anchor (#8710)', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'creator',
        monthlyTokens: 1000,
        monthlyTokensUsed: 200, // 800 remaining → rolls over on the first fire
        addonTokens: 0,
        earnedCredits: 0,
        stripeSubscriptionId: 'sub_x',
      });

      // First fire at 'creator': rolls LEAST(800, 1000)=800 into addon (0 → 800),
      // resets the cycle, grants 1000, writes renewal:creator / inv_xt.
      await handleInvoicePaid('cus_a', 'inv_xt', 'sub_x');
      const afterFirst = (await getUserRow(harness().neonSql, seeded.id))!;
      expect(num(afterFirst.addon_tokens)).toBe(800);

      // The user is upgraded to 'pro' (a separate subscription.updated) and
      // spends 400 of the fresh allocation BEFORE Stripe redelivers the SAME
      // invoice. The idempotency anchor must be the invoice id, NOT
      // renewal:<tier>: keying on the mutable user.tier lets the redelivery's
      // renewal:pro != the committed renewal:creator, re-opening every gate
      // (double rollover into addon + a second monthly grant + re-zeroed spend).
      await harness().neonSql`
        UPDATE users SET tier = 'pro', monthly_tokens_used = 400 WHERE id = ${seeded.id}::uuid
      `;

      await handleInvoicePaid('cus_a', 'inv_xt', 'sub_x'); // redelivery, now at 'pro'

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      expect(num(row.addon_tokens)).toBe(800);        // NO second rollover credit
      expect(num(row.monthly_tokens_used)).toBe(400); // spend preserved (no re-zero)
      expect(num(row.monthly_tokens)).toBe(1000);     // reset skipped → first-fire value

      // Exactly one renewal grant + one rollover row for this invoice,
      // regardless of which tier suffix the redelivery would have used.
      const all = await txns(seeded.id);
      expect(all.filter((r) => String(r.source).startsWith('renewal:'))).toHaveLength(1);
      expect(all.filter((r) => String(r.source).startsWith('renewal_rollover:'))).toHaveLength(1);
    });

    it('caps rollover at one allocation when remaining exceeds it (LEAST boundary)', async () => {
      // monthly_tokens can exceed the tier allocation (carried over from a prior
      // higher tier, or a promo grant). The rollover is LEAST(remaining, allocation),
      // never the full remaining — otherwise a renewal mints free non-expiring addon.
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'hobbyist',
        monthlyTokens: 900, // 3x the hobbyist allocation
        monthlyTokensUsed: 0, // 900 remaining > allocation 300
        addonTokens: 0,
        earnedCredits: 0,
        stripeSubscriptionId: 'sub_x',
      });

      await handleInvoicePaid('cus_a', 'inv_1', 'sub_x');

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      // Rollover capped at LEAST(900, 300) = 300, NOT 900.
      expect(num(row.addon_tokens)).toBe(300);
      expect(num(row.monthly_tokens)).toBe(300); // reset to allocation
      expect(num(row.monthly_tokens_used)).toBe(0);

      const all = await txns(seeded.id);
      expect(num(bySource(all, 'renewal_rollover:hobbyist').amount)).toBe(300); // capped
      expect(num(bySource(all, 'renewal:hobbyist').amount)).toBe(300);
    });

    it('a prior payment_failed row on the SAME invoice does NOT suppress the renewal (#8611)', async () => {
      // The renewal gate is `source LIKE 'renewal:%' AND reference_id = invoiceId`,
      // NOT `reference_id = invoiceId` alone. Stripe writes a `payment_failed:attempt_N`
      // audit row keyed on the SAME invoice id before the retry succeeds, so a gate
      // that looked only at reference_id would see that row and skip the entire
      // renewal — never resetting the cycle, never rolling over, never granting the
      // new allocation. This is the exact bug the SUT comment guards ("Gating on
      // reference_id alone is wrong — payment_failed:attempt_N rows share the
      // invoice id"); this test has teeth on that qualifier.
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'hobbyist',
        monthlyTokens: 300,
        monthlyTokensUsed: 100, // 200 unused → must still roll over
        addonTokens: 200,
        earnedCredits: 0,
        stripeSubscriptionId: 'sub_x',
      });

      // Attempt 1 fails first, stamping payment_failed:attempt_1 / inv_1.
      await handleInvoicePaymentFailed('cus_a', 'inv_1', 1, null);
      // Stripe retries the SAME invoice and it succeeds.
      await handleInvoicePaid('cus_a', 'inv_1', 'sub_x');

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      // Renewal processed in full despite the shared-invoice-id failure row.
      expect(num(row.monthly_tokens)).toBe(300); // reset to allocation
      expect(num(row.monthly_tokens_used)).toBe(0);
      expect(num(row.addon_tokens)).toBe(400); // 200 + LEAST(200, 300) rollover

      const all = await txns(seeded.id);
      // The failure audit row is untouched and the renewal rows are written once each.
      expect(all.filter((r) => r.source === 'payment_failed:attempt_1')).toHaveLength(1);
      expect(num(bySource(all, 'renewal_rollover:hobbyist').amount)).toBe(200);
      expect(num(bySource(all, 'renewal:hobbyist').amount)).toBe(300);
    });
  });

  // ───────────────────────── invoice.payment_failed ─────────────────────────
  describe('handleInvoicePaymentFailed', () => {
    it('records a zero-amount audit row at the current balance without changing the tier', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'hobbyist',
        monthlyTokens: 300,
        monthlyTokensUsed: 100,
        addonTokens: 200,
        earnedCredits: 0,
      });

      await handleInvoicePaymentFailed('cus_a', 'inv_f', 1, null);

      const row = (await getUserRow(harness().neonSql, seeded.id))!;
      expect(row.tier).toBe('hobbyist'); // grace period — no downgrade here
      expect(num(row.monthly_tokens)).toBe(300);
      expect(num(row.monthly_tokens_used)).toBe(100);

      const all = await txns(seeded.id);
      expect(all).toHaveLength(1);
      const failed = bySource(all, 'payment_failed:attempt_1');
      expect(failed.transaction_type).toBe('adjustment');
      expect(num(failed.amount)).toBe(0);
      // balance_after = remaining (200) + addon (200) + earned (0)
      expect(num(failed.balance_after)).toBe(400);
      expect(failed.reference_id).toBe('inv_f');
    });

    it('is a no-op when no user matches the customer', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'hobbyist',
      });

      await handleInvoicePaymentFailed('cus_gone', 'inv_f', 1, null);

      expect(await txns(seeded.id)).toHaveLength(0);
    });

    it('dedupes a redelivered attempt but logs a distinct later attempt (#8261)', async () => {
      const seeded = await seedUser(harness().neonSql, {
        stripeCustomerId: 'cus_a',
        tier: 'hobbyist',
        monthlyTokens: 300,
        monthlyTokensUsed: 0,
        addonTokens: 0,
      });

      await handleInvoicePaymentFailed('cus_a', 'inv_f', 1, null);
      await handleInvoicePaymentFailed('cus_a', 'inv_f', 1, null); // redelivery of attempt 1
      await handleInvoicePaymentFailed('cus_a', 'inv_f', 2, null); // genuine retry

      const all = await txns(seeded.id);
      expect(all.filter((r) => r.source === 'payment_failed:attempt_1')).toHaveLength(1);
      expect(all.filter((r) => r.source === 'payment_failed:attempt_2')).toHaveLength(1);
      expect(all).toHaveLength(2);
    });
  });
});
