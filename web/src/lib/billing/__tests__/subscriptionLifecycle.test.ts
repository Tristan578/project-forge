/**
 * Tests for subscription-lifecycle handler functions.
 * PF-515/PF-522: Atomic guard and purchase-based refund calculation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockInsertValues = vi.fn().mockResolvedValue({});
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockUpdateReturning = vi.fn().mockResolvedValue([{ id: 'user_abc' }]);
const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

const mockSelectWhere = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockTxInsertValues = vi.fn().mockResolvedValue({});
const mockTxInsert = vi.fn().mockReturnValue({ values: mockTxInsertValues });
const mockTxUpdateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
const mockTxUpdate = vi.fn().mockReturnValue({ set: mockTxUpdateSet });
const mockTxSelectWhere = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
const _mockTxSelectFrom = vi.fn().mockReturnValue({ where: mockTxSelectWhere });
const mockTxSelect = vi.fn().mockReturnValue({ from: _mockTxSelectFrom });

const mockTx = { insert: mockTxInsert, update: mockTxUpdate, select: mockTxSelect };

let lastTxConfig: unknown = undefined;
const mockTransaction = vi.fn(
  async (cb: (tx: typeof mockTx) => Promise<void>, config?: unknown) => {
    lastTxConfig = config;
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
  handleChargeRefunded,
  reverseAddonTokens,
} from '../subscription-lifecycle';

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
    mockUpdateReturning.mockResolvedValue([{ id: 'user_abc' }]);
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockTxUpdateSet.mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
  });

  it('findUserByStripeCustomer returns null when not found', async () => {
    mockSelectWhere.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) });
    expect(await findUserByStripeCustomer('cus_unknown')).toBeNull();
  });

  it('findUserByStripeCustomer returns user when found', async () => {
    expect(await findUserByStripeCustomer('cus_abc')).toMatchObject({ id: 'user_abc' });
  });

  it('handleSubscriptionDeleted resets tier', async () => {
    const { updateUserTier } = await import('@/lib/auth/user-service');
    await handleSubscriptionDeleted('cus_abc', 'sub_abc');
    expect(updateUserTier).toHaveBeenCalledWith('user_abc', 'starter');
  });

  it('PF-521: handleSubscriptionUpdated uses serializable tx', async () => {
    await handleSubscriptionUpdated('cus_abc', 'sub_new', 'pro', 'active');
    expect(lastTxConfig).toEqual({ isolationLevel: 'serializable' });
  });
});

describe('handleChargeRefunded (PF-515, PF-522)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectWhere.mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) });
    mockUpdateReturning.mockResolvedValue([{ id: 'user_abc' }]);
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
  });

  it('does nothing when user not found', async () => {
    mockSelectWhere.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) });
    await handleChargeRefunded('cus_gone', 'ch_1', 1000, 1000);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does nothing when amountTotal is 0', async () => {
    await handleChargeRefunded('cus_abc', 'ch_1', 500, 0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('PF-522: deducts based on purchase record tokens', async () => {
    mockSelectWhere
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([mockUser]) })
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ tokens: 10000 }]) })
      .mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) });
    await handleChargeRefunded('cus_abc', 'ch_full', 1000, 1000, 'pi_123');
    expect(mockInsertValues.mock.calls[0][0].amount).toBe(-10000);
  });

  it('PF-522: partial refund deducts proportionally', async () => {
    mockSelectWhere
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([mockUser]) })
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ tokens: 10000 }]) })
      .mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) });
    await handleChargeRefunded('cus_abc', 'ch_p', 500, 1000, 'pi_123');
    expect(mockInsertValues.mock.calls[0][0].amount).toBe(-5000);
  });
});

describe('reverseAddonTokens (PF-515)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectWhere.mockReturnValue({ limit: vi.fn().mockResolvedValue([{ tokens: 1000 }]) });
    mockUpdateReturning.mockResolvedValue([{ id: 'user_abc' }]);
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
  });

  it('skips when no purchase found', async () => {
    mockSelectWhere
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) });
    await reverseAddonTokens('user_abc', 'ch_1', 500, 1000, 'pi_x');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('PF-515: skips audit when atomic guard rejects', async () => {
    mockSelectWhere.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ tokens: 1000 }]) });
    mockUpdateReturning.mockResolvedValue([]);
    await reverseAddonTokens('user_abc', 'ch_x', 1000, 1000, 'pi_123');
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('falls back to amountCents match', async () => {
    mockSelectWhere
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ tokens: 2000 }]) })
      .mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) });
    await reverseAddonTokens('user_abc', 'ch_fb', 1000, 1000);
    expect(mockInsertValues.mock.calls[0][0].amount).toBe(-2000);
  });

  it('clamps ratio at 1', async () => {
    mockSelectWhere
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ tokens: 500 }]) })
      .mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) });
    await reverseAddonTokens('user_abc', 'ch_o', 2000, 1000, 'pi_123');
    expect(mockInsertValues.mock.calls[0][0].amount).toBe(-500);
  });

  it('skips when deduction rounds to 0', async () => {
    mockSelectWhere.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ tokens: 10 }]) });
    await reverseAddonTokens('user_abc', 'ch_t', 1, 10000, 'pi_123');
    expect(mockUpdate).not.toHaveBeenCalled();
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
