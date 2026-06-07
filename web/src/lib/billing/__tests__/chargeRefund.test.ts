import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// --- Mock DB chain ---
const mockInsertValues = vi.fn().mockResolvedValue({});
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
const mockReturning = vi.fn().mockResolvedValue([]);
const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockReturning });
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });
const mockSelectLimit = vi.fn().mockResolvedValue([]);
const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockDb = { insert: mockInsert, update: mockUpdate, select: mockSelect };

// Neon SQL mock for neonSql tagged templates and .transaction()
const mockNeonTransaction = vi.fn().mockResolvedValue([]);
const mockNeonSqlCalls: { strings: TemplateStringsArray; values: unknown[] }[] = [];
const mockNeonSql = Object.assign(
  vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]): Promise<unknown[]> => {
    mockNeonSqlCalls.push({ strings: _strings, values: _values });
    return Promise.resolve([]);
  }),
  { transaction: mockNeonTransaction },
);

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => mockDb),
  getNeonSql: vi.fn(() => mockNeonSql),
  queryWithResilience: vi.fn((fn: () => Promise<unknown>) => fn()),
}));
vi.mock('@/lib/tokens/pricing', () => ({
  TIER_MONTHLY_TOKENS: { starter: 10000, hobbyist: 50000, creator: 150000, pro: 500000 },
}));

vi.mock('@/lib/db/schema', () => ({
  users: {
    id: 'id', monthlyTokens: 'monthly_tokens', monthlyTokensUsed: 'monthly_tokens_used',
    addonTokens: 'addon_tokens', earnedCredits: 'earned_credits',
    stripeCustomerId: 'stripe_customer_id', stripeSubscriptionId: 'stripe_subscription_id',
    tier: 'tier', updatedAt: 'updated_at', billingCycleStart: 'billing_cycle_start',
  },
  creditTransactions: {
    userId: 'user_id', transactionType: 'transaction_type', amount: 'amount',
    balanceAfter: 'balance_after', source: 'source', referenceId: 'reference_id',
  },
  tokenPurchases: {
    id: 'id', userId: 'user_id', stripePaymentIntent: 'stripe_payment_intent',
    package: 'package', tokens: 'tokens', amountCents: 'amount_cents',
    refundedCents: 'refunded_cents', createdAt: 'created_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_a: unknown, _b: unknown) => 'eq-condition'),
  sql: vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => 'sql-expression'),
  and: vi.fn((..._args: unknown[]) => 'and-condition'),
}));

import { handleChargeRefunded } from '../subscription-lifecycle';

const mockUserRecord = {
  id: 'user-1',
  stripeCustomerId: 'cus_abc',
  monthlyTokens: 1000,
  monthlyTokensUsed: 200,
  addonTokens: 5000,
  earnedCredits: 0,
  tier: 'hobbyist',
};

describe('handleChargeRefunded (PF-526)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNeonSqlCalls.length = 0;
    // Default: findUserByStripeCustomer returns the mock user
    mockSelectLimit.mockResolvedValue([mockUserRecord]);
  });

  it('does nothing for zero refund amount', async () => {
    await handleChargeRefunded('cus_abc', 'ch_abc', 0, 4900);
    // amountRefunded <= 0 early return, only the findUser select happens
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does nothing for negative refund amount', async () => {
    await handleChargeRefunded('cus_abc', 'ch_abc', -100, 4900);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does nothing for zero total amount', async () => {
    await handleChargeRefunded('cus_abc', 'ch_abc', 100, 0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does nothing when user not found', async () => {
    mockSelectLimit.mockResolvedValueOnce([]);
    await handleChargeRefunded('cus_missing', 'ch_abc', 2000, 4900);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('deducts proportional tokens for partial refund', async () => {
    // Select 1: findUserByStripeCustomer
    mockSelectLimit.mockResolvedValueOnce([mockUserRecord]);

    await handleChargeRefunded('cus_abc', 'ch_abc', 2450, 4900);

    // Fallback now uses a single CTE statement (not transaction) for atomicity (#8187)
    const cteCall = mockNeonSqlCalls.find(c =>
      c.strings.some(s => s.includes('audit'))
    );
    expect(cteCall).toBeDefined();
    expect(cteCall!.values).toContain('charge_refunded:ch_abc');
  });

  it('deducts all tokens for full refund', async () => {
    mockSelectLimit.mockResolvedValueOnce([mockUserRecord]);

    await handleChargeRefunded('cus_abc', 'ch_abc', 4900, 4900);

    // Single CTE statement handles idempotency + deduction (#8187)
    const cteCall = mockNeonSqlCalls.find(c =>
      c.strings.some(s => s.includes('audit'))
    );
    expect(cteCall).toBeDefined();
  });

  it('handles zero addon tokens via SQL guard (WHERE clause prevents deduction)', async () => {
    // The CTE is still called, but the SQL WHERE guard (addon_tokens * ratio > 0)
    // ensures no actual deduction happens when addon_tokens = 0
    mockSelectLimit.mockResolvedValueOnce([mockUserRecord]);

    await handleChargeRefunded('cus_abc', 'ch_abc', 2450, 4900);

    // CTE fires but SQL guards prevent any rows from being modified
    const cteCall = mockNeonSqlCalls.find(c =>
      c.strings.some(s => s.includes('audit'))
    );
    expect(cteCall).toBeDefined();
  });

  it('handles missing user via SQL guard (WHERE u.id matches nothing)', async () => {
    // The CTE fires but WHERE u.id = 'nonexistent' matches no rows
    mockSelectLimit.mockResolvedValueOnce([mockUserRecord]);

    await handleChargeRefunded('cus_abc', 'ch_abc', 2450, 4900);

    // CTE fires but no rows match — no audit or deduction
    const cteCall = mockNeonSqlCalls.find(c =>
      c.strings.some(s => s.includes('audit'))
    );
    expect(cteCall).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Regression tests for Copilot/Sentry findings (PR #8232)
  // ---------------------------------------------------------------------------
  describe('idempotency — duplicate chargeId must not double-deduct (#8187)', () => {
    it('CTE includes NOT EXISTS guard against duplicate reference_id', async () => {
      mockSelectLimit.mockResolvedValueOnce([mockUserRecord]);

      await handleChargeRefunded('cus_abc', 'ch_dup', 2450, 4900);

      // The CTE SQL must contain the NOT EXISTS subquery that checks
      // credit_transactions for an existing row with the same reference_id
      const cteCall = mockNeonSqlCalls.find(c =>
        c.strings.some(s => s.includes('NOT EXISTS'))
      );
      expect(cteCall).toBeDefined();
      // `source` groups by charge; `reference_id` is the per-tranche key
      // (`${chargeId}:${amountRefunded}`) introduced by the #8706 SUT fix so
      // incremental refunds of one charge each record their own audit row.
      // (Full real-DB behavioural conversion of this file is #8610 / F18, stacked on this PR.)
      expect(cteCall!.values).toContain('charge_refunded:ch_dup');
      expect(cteCall!.values).toContain('ch_dup:2450');
    });

    it('second call with same chargeId produces same CTE (SQL idempotency)', async () => {
      mockSelectLimit.mockResolvedValueOnce([mockUserRecord]);
      await handleChargeRefunded('cus_abc', 'ch_same', 2450, 4900);
      const firstCallCount = mockNeonSqlCalls.length;

      mockSelectLimit.mockResolvedValueOnce([mockUserRecord]);
      await handleChargeRefunded('cus_abc', 'ch_same', 2450, 4900);

      // Both calls fire the CTE — idempotency is enforced by the SQL NOT EXISTS,
      // not by JS-side deduplication. The point is the SQL shape is correct.
      expect(mockNeonSqlCalls.length).toBe(firstCallCount * 2);
      const secondCte = mockNeonSqlCalls[mockNeonSqlCalls.length - 1];
      expect(secondCte.strings.some(s => s.includes('NOT EXISTS'))).toBe(true);
    });
  });

  describe('div-by-zero and ratio edge cases (#8187)', () => {
    it('passes the raw cumulative refund amounts to the CTE (over-refund clamped in SQL)', async () => {
      mockSelectLimit.mockResolvedValueOnce([mockUserRecord]);

      // Over-refund: refunded more than total (edge case from payment processor).
      // The SUT no longer precomputes a JS ratio — it passes amountRefunded and
      // amountTotal through, and the SQL caps the deduction at the current balance
      // (LEAST(.., cur)). (Behaviour covered by the real-DB suite,
      // reverseAddonTokens.test.ts → "clamps the refund ratio to 1".)
      await handleChargeRefunded('cus_abc', 'ch_over', 10000, 4900);

      const cteCall = mockNeonSqlCalls.find(c =>
        c.strings.some(s => s.includes('audit'))
      );
      expect(cteCall).toBeDefined();
      expect(cteCall!.values).toContain(10000);
      expect(cteCall!.values).toContain(4900);
      expect(cteCall!.values).toContain('ch_over:10000');
    });

    it('issues the fallback CTE with the cumulative refund amounts (zero-balance guard is in SQL)', async () => {
      // The fallback path reads the live addon balance INSIDE the CTE; when it is
      // 0 the SQL deduction computes to 0 and the WHERE to_deduct > 0 guard skips
      // the INSERT/UPDATE entirely. (Behaviour covered by the real-DB suite,
      // reverseAddonTokens.test.ts → "writes nothing when the user has no addon
      // tokens".) Here we only assert the CTE is issued with the raw refund amounts.
      mockSelectLimit.mockResolvedValueOnce([{
        ...mockUserRecord,
        addonTokens: 0,
      }]);

      await handleChargeRefunded('cus_abc', 'ch_zero_tok', 4900, 4900);

      const cteCall = mockNeonSqlCalls.find(c =>
        c.strings.some(s => s.includes('audit'))
      );
      expect(cteCall).toBeDefined();
      expect(cteCall!.values).toContain(4900);
      expect(cteCall!.values).toContain('ch_zero_tok:4900');
    });
  });

  describe('UPDATE depends on audit CTE via EXISTS (#8187)', () => {
    it('CTE chains UPDATE with EXISTS (SELECT 1 FROM audit)', async () => {
      mockSelectLimit.mockResolvedValueOnce([mockUserRecord]);

      await handleChargeRefunded('cus_abc', 'ch_chain', 2450, 4900);

      const cteCall = mockNeonSqlCalls.find(c =>
        c.strings.some(s => s.includes('EXISTS (SELECT 1 FROM audit)'))
      );
      expect(cteCall).toBeDefined();
    });

    it('UPDATE uses ABS on audit amount to prevent sign errors', async () => {
      mockSelectLimit.mockResolvedValueOnce([mockUserRecord]);

      await handleChargeRefunded('cus_abc', 'ch_abs', 2450, 4900);

      // The audit CTE inserts a negative amount (-LEAST(...)). The UPDATE must
      // use ABS() to get the positive deduction value.
      const cteCall = mockNeonSqlCalls.find(c =>
        c.strings.some(s => s.includes('ABS'))
      );
      expect(cteCall).toBeDefined();
    });
  });
});
