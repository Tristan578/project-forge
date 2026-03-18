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

vi.mock('@/lib/db/client', () => ({ getDb: vi.fn(() => mockDb) }));
vi.mock('@/lib/auth/user-service', () => ({ updateUserTier: vi.fn().mockResolvedValue(undefined) }));
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
    // First select: findUserByStripeCustomer
    // Second select: reverseAddonTokens reads addonTokens
    // Third select: getTotalBalance
    mockSelectLimit
      .mockResolvedValueOnce([mockUserRecord])
      .mockResolvedValueOnce([{ addonTokens: 5000 }])
      .mockResolvedValueOnce([mockUserRecord]);

    await handleChargeRefunded('cus_abc', 'ch_abc', 2450, 4900);

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalled();
  });

  it('deducts all tokens for full refund', async () => {
    mockSelectLimit
      .mockResolvedValueOnce([mockUserRecord])
      .mockResolvedValueOnce([{ addonTokens: 5000 }])
      .mockResolvedValueOnce([mockUserRecord]);

    await handleChargeRefunded('cus_abc', 'ch_abc', 4900, 4900);

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalled();
  });

  it('skips deduction when user has zero addon tokens', async () => {
    mockSelectLimit
      .mockResolvedValueOnce([mockUserRecord])
      .mockResolvedValueOnce([{ addonTokens: 0 }]);

    await handleChargeRefunded('cus_abc', 'ch_abc', 2450, 4900);

    // No update because tokensToDeduct is 0
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('skips deduction when reverseAddonTokens user not found', async () => {
    // findUserByStripeCustomer returns user
    // reverseAddonTokens select returns empty
    mockSelectLimit
      .mockResolvedValueOnce([mockUserRecord])
      .mockResolvedValueOnce([]);

    await handleChargeRefunded('cus_abc', 'ch_abc', 2450, 4900);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
