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
