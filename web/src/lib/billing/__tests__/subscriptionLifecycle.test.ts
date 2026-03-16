/**
 * Tests for subscription-lifecycle handler functions.
 *
 * PF-513/PF-514/PF-521: Transaction isolation tests verify that
 * handleSubscriptionUpdated wraps tier change + token adjustment + balance
 * read in a serializable transaction.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockInsertValues = vi.fn().mockResolvedValue({});
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockUpdateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

const mockSelectWhere = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockTxInsertValues = vi.fn().mockResolvedValue({});
const mockTxInsert = vi.fn().mockReturnValue({ values: mockTxInsertValues });
const mockTxUpdateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
const mockTxUpdate = vi.fn().mockReturnValue({ set: mockTxUpdateSet });
const mockTxSelectWhere = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
const mockTxSelectFrom = vi.fn().mockReturnValue({ where: mockTxSelectWhere });
const mockTxSelect = vi.fn().mockReturnValue({ from: mockTxSelectFrom });

const mockTx = { insert: mockTxInsert, update: mockTxUpdate, select: mockTxSelect };

let lastTransactionConfig: unknown = undefined;
const mockTransaction = vi.fn(
  async (cb: (tx: typeof mockTx) => Promise<void>, config?: unknown) => {
    lastTransactionConfig = config;
    return cb(mockTx);
  }
);

const mockDb = { insert: mockInsert, update: mockUpdate, select: mockSelect, transaction: mockTransaction };

vi.mock('@/lib/db/client', () => ({ getDb: vi.fn(() => mockDb) }));
vi.mock('@/lib/auth/user-service', () => ({ updateUserTier: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/tokens/pricing', () => ({
  TIER_MONTHLY_TOKENS: { starter: 10000, hobbyist: 50000, creator: 150000, pro: 500000 },
}));

import {
  findUserByStripeCustomer,
  handleSubscriptionDeleted,
  handleSubscriptionUpdated,
} from '../subscription-lifecycle';

const mockUser = {
  id: 'user_abc', tier: 'creator', stripeCustomerId: 'cus_abc',
  stripeSubscriptionId: 'sub_abc', monthlyTokens: 150000,
  monthlyTokensUsed: 30000, addonTokens: 5000, earnedCredits: 0,
};

describe('subscription-lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastTransactionConfig = undefined;
    mockSelectWhere.mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) });
    mockTxSelectWhere.mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) });
    mockUpdateSet.mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
    mockTxUpdateSet.mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
  });

  describe('findUserByStripeCustomer', () => {
    it('returns the user when found', async () => {
      const user = await findUserByStripeCustomer('cus_abc');
      expect(user).toMatchObject({ id: 'user_abc' });
    });

    it('returns null when user is not found', async () => {
      mockSelectWhere.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) });
      const user = await findUserByStripeCustomer('cus_unknown');
      expect(user).toBeNull();
    });
  });

  describe('handleSubscriptionDeleted', () => {
    it('does nothing when user is not found', async () => {
      mockSelectWhere.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) });
      await expect(handleSubscriptionDeleted('cus_gone', 'sub_gone')).resolves.toBeUndefined();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('resets tier to starter and zeroes monthly tokens', async () => {
      const { updateUserTier } = await import('@/lib/auth/user-service');
      await handleSubscriptionDeleted('cus_abc', 'sub_abc');
      expect(updateUserTier).toHaveBeenCalledWith('user_abc', 'starter');
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalled();
    });
  });

  describe('handleSubscriptionUpdated -- transaction isolation', () => {
    it('PF-513: tier update happens inside the transaction, not via updateUserTier', async () => {
      const { updateUserTier } = await import('@/lib/auth/user-service');
      await handleSubscriptionUpdated('cus_abc', 'sub_new', 'pro', 'active');
      const calls = vi.mocked(updateUserTier).mock.calls;
      expect(calls.find((c) => c[0] === 'user_abc' && c[1] === 'pro')).toBeUndefined();
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTxUpdate).toHaveBeenCalled();
    });

    it('PF-514: getTotalBalance reads through tx, not global db', async () => {
      await handleSubscriptionUpdated('cus_abc', 'sub_new', 'pro', 'active');
      expect(mockTxSelect).toHaveBeenCalled();
    });

    it('PF-521: transaction uses serializable isolation level', async () => {
      await handleSubscriptionUpdated('cus_abc', 'sub_new', 'pro', 'active');
      expect(lastTransactionConfig).toEqual({ isolationLevel: 'serializable' });
    });

    it('uses transaction for downgrades too', async () => {
      await handleSubscriptionUpdated('cus_abc', 'sub_new', 'hobbyist', 'active');
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(lastTransactionConfig).toEqual({ isolationLevel: 'serializable' });
      expect(mockTxUpdate).toHaveBeenCalled();
      expect(mockTxInsert).toHaveBeenCalled();
    });

    it('does not use transaction when tier has not changed', async () => {
      await handleSubscriptionUpdated('cus_abc', 'sub_new', 'creator', 'active');
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('does not use transaction for past_due status', async () => {
      await handleSubscriptionUpdated('cus_abc', 'sub_new', 'pro', 'past_due');
      expect(mockTransaction).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// handleChargeRefunded + reverseAddonTokens (PF-480)
// ---------------------------------------------------------------------------

import {
  handleChargeRefunded,
  reverseAddonTokens,
} from '../subscription-lifecycle';

describe('handleChargeRefunded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([mockUser]),
    });
    mockUpdateSet.mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
  });

  it('does nothing when user is not found', async () => {
    mockSelectWhere.mockReturnValueOnce({
      limit: vi.fn().mockResolvedValue([]),
    });
    await handleChargeRefunded('cus_gone', 'ch_1', 1000, 1000);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does nothing when amountTotal is 0', async () => {
    await handleChargeRefunded('cus_abc', 'ch_1', 500, 0);
    // First select finds user, but early return before reverseAddonTokens
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does nothing when amountRefunded is 0', async () => {
    await handleChargeRefunded('cus_abc', 'ch_1', 0, 1000);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('calls reverseAddonTokens for a full refund', async () => {
    // User has 5000 addon tokens, full refund (amount_refunded == amount)
    await handleChargeRefunded('cus_abc', 'ch_full', 1000, 1000);
    // reverseAddonTokens triggers a select (for addonTokens) + update + insert
    // The second select (inside reverseAddonTokens) is also mocked
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalled();
  });

  it('calls reverseAddonTokens for a partial refund', async () => {
    await handleChargeRefunded('cus_abc', 'ch_partial', 500, 1000);
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalled();
  });
});

describe('reverseAddonTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock returns user with addonTokens
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([{ addonTokens: 1000 }]),
    });
    mockUpdateSet.mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
  });

  it('does nothing when user not found', async () => {
    mockSelectWhere.mockReturnValueOnce({
      limit: vi.fn().mockResolvedValue([]),
    });
    await reverseAddonTokens('ghost', 'ch_1', 500, 1000);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('deducts proportional tokens for partial refund', async () => {
    // 50% refund of user with 1000 addon tokens = 500 deducted
    await reverseAddonTokens('user_abc', 'ch_partial', 500, 1000);
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalled();
    const insertValues = mockInsertValues.mock.calls[0][0];
    expect(insertValues.transactionType).toBe('adjustment');
    expect(insertValues.amount).toBe(-500);
    expect(insertValues.source).toBe('charge_refunded:ch_partial');
  });

  it('deducts all tokens for full refund', async () => {
    await reverseAddonTokens('user_abc', 'ch_full', 1000, 1000);
    expect(mockUpdate).toHaveBeenCalled();
    const insertValues = mockInsertValues.mock.calls[0][0];
    expect(insertValues.amount).toBe(-1000);
  });

  it('clamps deduction ratio to 1 when refund exceeds total', async () => {
    // Edge case: amountRefunded > amountTotal — ratio capped at 1
    await reverseAddonTokens('user_abc', 'ch_over', 2000, 1000);
    expect(mockUpdate).toHaveBeenCalled();
    const insertValues = mockInsertValues.mock.calls[0][0];
    // All 1000 tokens deducted (ratio=1.0 => floor(1000*1)=1000)
    expect(insertValues.amount).toBe(-1000);
  });

  it('does nothing when calculated deduction is 0', async () => {
    // Very small refund that rounds down to 0 tokens
    mockSelectWhere.mockReturnValueOnce({
      limit: vi.fn().mockResolvedValue([{ addonTokens: 10 }]),
    });
    // 1 cent refund of $100 = 0.01 ratio, floor(10 * 0.01) = 0
    await reverseAddonTokens('user_abc', 'ch_tiny', 1, 10000);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
