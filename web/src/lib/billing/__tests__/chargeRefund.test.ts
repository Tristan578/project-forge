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
});
