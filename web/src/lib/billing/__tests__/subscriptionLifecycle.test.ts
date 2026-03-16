/**
 * Tests for subscription-lifecycle handler functions.
 *
 * The in-memory claimEvent/releaseEvent guards were removed when the
 * idempotency layer was promoted to webhookIdempotency.ts (DB-backed).
 * These tests cover the remaining business logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// Mock DB insert / update / select chains
const mockInsertValues = vi.fn().mockResolvedValue({});
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockUpdateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

const mockSelectWhere = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockDb = { insert: mockInsert, update: mockUpdate, select: mockSelect };

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => mockDb),
}));

vi.mock('@/lib/auth/user-service', () => ({
  updateUserTier: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/tokens/pricing', () => ({
  TIER_MONTHLY_TOKENS: {
    starter: 10000,
    hobbyist: 50000,
    creator: 150000,
    pro: 500000,
  },
}));

import {
  findUserByStripeCustomer,
  handleSubscriptionDeleted,
} from '../subscription-lifecycle';

const mockUser = {
  id: 'user_abc',
  tier: 'creator',
  stripeCustomerId: 'cus_abc',
  stripeSubscriptionId: 'sub_abc',
  monthlyTokens: 150000,
  monthlyTokensUsed: 30000,
  addonTokens: 5000,
  earnedCredits: 0,
};

describe('subscription-lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: user found by customer ID
    mockSelectWhere.mockReturnValue({
      limit: vi.fn().mockResolvedValue([mockUser]),
    });
    mockUpdateSet.mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
  });

  describe('findUserByStripeCustomer', () => {
    it('returns the user when found', async () => {
      const user = await findUserByStripeCustomer('cus_abc');
      expect(user).toMatchObject({ id: 'user_abc' });
    });

    it('returns null when user is not found', async () => {
      mockSelectWhere.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValue([]),
      });
      const user = await findUserByStripeCustomer('cus_unknown');
      expect(user).toBeNull();
    });
  });

  describe('handleSubscriptionDeleted', () => {
    it('does nothing when user is not found', async () => {
      mockSelectWhere.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValue([]),
      });
      await expect(
        handleSubscriptionDeleted('cus_gone', 'sub_gone')
      ).resolves.toBeUndefined();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('resets tier to starter and zeroes monthly tokens when user is found', async () => {
      const { updateUserTier } = await import('@/lib/auth/user-service');

      await handleSubscriptionDeleted('cus_abc', 'sub_abc');

      expect(updateUserTier).toHaveBeenCalledWith('user_abc', 'starter');
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalled(); // credit_transactions audit
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
