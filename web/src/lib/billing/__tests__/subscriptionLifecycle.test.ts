import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockInsertValues = vi.fn().mockResolvedValue({});
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
const mockUpdateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });
const mockSelectWhere = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
const mockSelect = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: mockSelectWhere }) });

const mockTxInsertValues = vi.fn().mockResolvedValue({});
const mockTxInsert = vi.fn().mockReturnValue({ values: mockTxInsertValues });
const mockTxUpdateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
const mockTxUpdate = vi.fn().mockReturnValue({ set: mockTxUpdateSet });
const mockTxSelectWhere = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
const mockTxSelect = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: mockTxSelectWhere }) });

const mockTx = { insert: mockTxInsert, update: mockTxUpdate, select: mockTxSelect };

let lastTxConfig: unknown = undefined;
const mockTransaction = vi.fn(async (cb: (tx: typeof mockTx) => Promise<void>, config?: unknown) => {
  lastTxConfig = config;
  return cb(mockTx);
});

const mockDb = { insert: mockInsert, update: mockUpdate, select: mockSelect, transaction: mockTransaction };

vi.mock('@/lib/db/client', () => ({ getDb: vi.fn(() => mockDb) }));
vi.mock('@/lib/auth/user-service', () => ({ updateUserTier: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/tokens/pricing', () => ({
  TIER_MONTHLY_TOKENS: { starter: 10000, hobbyist: 50000, creator: 150000, pro: 500000 },
}));

import { findUserByStripeCustomer, handleSubscriptionDeleted, handleSubscriptionUpdated } from '../subscription-lifecycle';

const mockUser = {
  id: 'user_abc', tier: 'creator', stripeCustomerId: 'cus_abc',
  stripeSubscriptionId: 'sub_abc', monthlyTokens: 150000,
  monthlyTokensUsed: 30000, addonTokens: 5000, earnedCredits: 0,
};

describe('subscription-lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastTxConfig = undefined;
    mockSelectWhere.mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) });
    mockTxSelectWhere.mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) });
    mockUpdateSet.mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
    mockTxUpdateSet.mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
  });

  describe('findUserByStripeCustomer', () => {
    it('returns the user when found', async () => {
      expect(await findUserByStripeCustomer('cus_abc')).toMatchObject({ id: 'user_abc' });
    });
    it('returns null when not found', async () => {
      mockSelectWhere.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) });
      expect(await findUserByStripeCustomer('cus_x')).toBeNull();
    });
  });

  describe('handleSubscriptionDeleted', () => {
    it('does nothing when user not found', async () => {
      mockSelectWhere.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) });
      await handleSubscriptionDeleted('cus_gone', 'sub_gone');
      expect(mockUpdate).not.toHaveBeenCalled();
    });
    it('resets tier to starter', async () => {
      const { updateUserTier } = await import('@/lib/auth/user-service');
      await handleSubscriptionDeleted('cus_abc', 'sub_abc');
      expect(updateUserTier).toHaveBeenCalledWith('user_abc', 'starter');
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalled();
    });
  });

  describe('handleSubscriptionUpdated -- transaction isolation', () => {
    it('PF-513: tier update inside transaction, not via updateUserTier', async () => {
      const { updateUserTier } = await import('@/lib/auth/user-service');
      await handleSubscriptionUpdated('cus_abc', 'sub_new', 'pro', 'active');
      expect(vi.mocked(updateUserTier).mock.calls.find((c) => c[0] === 'user_abc' && c[1] === 'pro')).toBeUndefined();
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTxUpdate).toHaveBeenCalled();
    });

    it('PF-514: getTotalBalance reads through tx', async () => {
      await handleSubscriptionUpdated('cus_abc', 'sub_new', 'pro', 'active');
      expect(mockTxSelect).toHaveBeenCalled();
    });

    it('PF-521: serializable isolation level', async () => {
      await handleSubscriptionUpdated('cus_abc', 'sub_new', 'pro', 'active');
      expect(lastTxConfig).toEqual({ isolationLevel: 'serializable' });
    });

    it('uses transaction for downgrades too', async () => {
      await handleSubscriptionUpdated('cus_abc', 'sub_new', 'hobbyist', 'active');
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(lastTxConfig).toEqual({ isolationLevel: 'serializable' });
    });

    it('no transaction when tier unchanged', async () => {
      await handleSubscriptionUpdated('cus_abc', 'sub_new', 'creator', 'active');
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('no transaction for past_due', async () => {
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
} from '../subscription-lifecycle';

describe('handleChargeRefunded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([mockUser]),
    });
    mockUpdateSet.mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
  });

  it('does nothing when payment intent not found', async () => {
    mockSelectWhere.mockReturnValueOnce({
      limit: vi.fn().mockResolvedValue([]),
    });
    await handleChargeRefunded('pi_gone', 1000);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does nothing when refundAmountCents is 0', async () => {
    await handleChargeRefunded('pi_abc', 0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does nothing when refundAmountCents is negative', async () => {
    await handleChargeRefunded('pi_abc', -100);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('processes a full refund', async () => {
    await handleChargeRefunded('pi_abc', 2450);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('processes a partial refund', async () => {
    await handleChargeRefunded('pi_abc', 500);
    expect(mockUpdate).toHaveBeenCalled();
  });
});

