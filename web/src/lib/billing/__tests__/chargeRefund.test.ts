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

const mockPurchase = {
  id: 'purchase-1',
  userId: 'user-1',
  stripePaymentIntent: 'pi_abc',
  package: 'blaze',
  tokens: 5000,
  amountCents: 4900,
  refundedCents: 0,
  createdAt: new Date(),
};

const mockUser = {
  monthlyTokens: 1000,
  monthlyTokensUsed: 200,
  addonTokens: 5000,
  earnedCredits: 0,
};

describe('handleChargeRefunded (PF-526)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectLimit.mockResolvedValue([mockPurchase]);
    mockReturning.mockResolvedValue([{ id: 'purchase-1' }]);
    mockUpdateWhere.mockReturnValue({ returning: mockReturning });
  });

  it('does nothing for zero refund amount', async () => {
    await handleChargeRefunded('pi_abc', 0);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('does nothing for negative refund amount', async () => {
    await handleChargeRefunded('pi_abc', -100);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('does nothing when purchase not found', async () => {
    mockSelectLimit.mockResolvedValueOnce([]);
    await handleChargeRefunded('pi_missing', 2000);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('deducts proportional tokens for partial refund', async () => {
    mockSelectLimit
      .mockResolvedValueOnce([mockPurchase])
      .mockResolvedValueOnce([mockUser]);

    await handleChargeRefunded('pi_abc', 2450);

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalled();
  });

  it('does nothing when purchase is already fully refunded', async () => {
    const fullyRefunded = { ...mockPurchase, refundedCents: 4900 };
    mockSelectLimit.mockResolvedValueOnce([fullyRefunded]);

    await handleChargeRefunded('pi_abc', 100);

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('PF-526: double refund -- second refund uses remaining portion', async () => {
    mockSelectLimit
      .mockResolvedValueOnce([{ ...mockPurchase, refundedCents: 0 }])
      .mockResolvedValueOnce([mockUser]);

    await handleChargeRefunded('pi_abc', 2450);
    expect(mockUpdate.mock.calls.length).toBeGreaterThan(0);

    vi.clearAllMocks();
    mockUpdateWhere.mockReturnValue({ returning: mockReturning });
    mockReturning.mockResolvedValue([{ id: 'purchase-1' }]);

    const afterFirstRefund = { ...mockPurchase, refundedCents: 2450 };
    mockSelectLimit
      .mockResolvedValueOnce([afterFirstRefund])
      .mockResolvedValueOnce([mockUser]);

    await handleChargeRefunded('pi_abc', 2450);

    expect(mockUpdate).toHaveBeenCalled();
  });

  it('skips token deduction when atomic update fails (race condition)', async () => {
    mockSelectLimit.mockResolvedValueOnce([mockPurchase]);
    mockReturning.mockResolvedValueOnce([]);

    await handleChargeRefunded('pi_abc', 2450);

    expect(mockInsert).not.toHaveBeenCalled();
  });
});
