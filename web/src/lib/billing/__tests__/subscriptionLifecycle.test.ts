/**
 * Tests for subscription-lifecycle handler functions.
 *
 * PF-77: All multi-statement mutations now use neonSql.transaction() for
 * atomicity instead of separate Drizzle calls or the broken db.transaction().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// Drizzle ORM mock (reads only)
const mockInsertValues = vi.fn().mockResolvedValue({});
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockUpdateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

const mockSelectWhere = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockDb = { insert: mockInsert, update: mockUpdate, select: mockSelect };

// Neon SQL mock
interface MockStatement { _type: 'neon_statement'; values: unknown[] }
const mockNeonTransaction = vi.fn().mockResolvedValue([]);
const mockNeonSql = Object.assign(
  vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]): MockStatement => ({
    _type: 'neon_statement',
    values: _values,
  })),
  { transaction: mockNeonTransaction },
);

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => mockDb),
  getNeonSql: vi.fn(() => mockNeonSql),
}));
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
    mockSelectWhere.mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) });
    mockUpdateSet.mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
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
      expect(mockNeonTransaction).not.toHaveBeenCalled();
    });

    it('wraps tier revert in neonSql.transaction (PF-77)', async () => {
      await handleSubscriptionDeleted('cus_abc', 'sub_abc');
      expect(mockNeonTransaction).toHaveBeenCalledOnce();
    });
  });

  describe('handleSubscriptionUpdated -- neon transaction (PF-77)', () => {
    it('uses neonSql.transaction for tier change, not db.transaction', async () => {
      await handleSubscriptionUpdated('cus_abc', 'sub_new', 'pro', 'active');
      expect(mockNeonTransaction).toHaveBeenCalledOnce();
    });

    it('does not use transaction when tier has not changed', async () => {
      await handleSubscriptionUpdated('cus_abc', 'sub_new', 'creator', 'active');
      expect(mockNeonTransaction).not.toHaveBeenCalled();
    });

    it('does not use transaction for past_due status', async () => {
      await handleSubscriptionUpdated('cus_abc', 'sub_new', 'pro', 'past_due');
      expect(mockNeonTransaction).not.toHaveBeenCalled();
    });

    it('uses transaction for downgrades', async () => {
      await handleSubscriptionUpdated('cus_abc', 'sub_new', 'hobbyist', 'active');
      expect(mockNeonTransaction).toHaveBeenCalledOnce();
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
    expect(mockNeonTransaction).not.toHaveBeenCalled();
  });

  it('does nothing when amountTotal is 0', async () => {
    await handleChargeRefunded('cus_abc', 'ch_1', 500, 0);
    expect(mockNeonTransaction).not.toHaveBeenCalled();
  });

  it('does nothing when amountRefunded is 0', async () => {
    await handleChargeRefunded('cus_abc', 'ch_1', 0, 1000);
    expect(mockNeonTransaction).not.toHaveBeenCalled();
  });

  it('calls reverseAddonTokens for a full refund (fallback path)', async () => {
    // Select 1: findUserByStripeCustomer -> mockUser
    // Select 2: fallback idempotency check -> no existing refund
    // Select 3: user addonTokens lookup
    mockSelectWhere
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([mockUser]) })
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ addonTokens: 5000, monthlyTokens: 150000, monthlyTokensUsed: 30000, earnedCredits: 0 }]) });
    await handleChargeRefunded('cus_abc', 'ch_full', 1000, 1000);
    expect(mockNeonTransaction).toHaveBeenCalledOnce();
  });
});

describe('reverseAddonTokens (fallback path, no paymentIntentId)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateSet.mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
  });

  it('does nothing when user not found', async () => {
    mockSelectWhere
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) });
    await reverseAddonTokens('ghost', 'ch_1', 500, 1000);
    expect(mockNeonTransaction).not.toHaveBeenCalled();
  });

  it('deducts proportional tokens for partial refund via neonSql.transaction', async () => {
    mockSelectWhere
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ addonTokens: 1000, monthlyTokens: 0, monthlyTokensUsed: 0, earnedCredits: 0 }]) });
    await reverseAddonTokens('user_abc', 'ch_partial', 500, 1000);
    expect(mockNeonTransaction).toHaveBeenCalledOnce();

    // Check the INSERT statement values include the deduction amount
    const allCalls = mockNeonSql.mock.calls;
    const insertCall = allCalls[allCalls.length - 1];
    const insertValues = insertCall.slice(1).flat();
    expect(insertValues).toContain(-500); // deduction
    expect(insertValues).toContain('charge_refunded:ch_partial');
  });

  it('deducts all tokens for full refund', async () => {
    mockSelectWhere
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ addonTokens: 1000, monthlyTokens: 0, monthlyTokensUsed: 0, earnedCredits: 0 }]) });
    await reverseAddonTokens('user_abc', 'ch_full', 1000, 1000);
    expect(mockNeonTransaction).toHaveBeenCalledOnce();

    const allCalls = mockNeonSql.mock.calls;
    const insertCall = allCalls[allCalls.length - 1];
    const insertValues = insertCall.slice(1).flat();
    expect(insertValues).toContain(-1000);
  });

  it('does nothing when calculated deduction is 0', async () => {
    mockSelectWhere
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ addonTokens: 10, monthlyTokens: 0, monthlyTokensUsed: 0, earnedCredits: 0 }]) });
    // 1 cent refund of $100 = 0.01 ratio, floor(10 * 0.01) = 0
    await reverseAddonTokens('user_abc', 'ch_tiny', 1, 10000);
    expect(mockNeonTransaction).not.toHaveBeenCalled();
  });

  it('skips when refund already exists (idempotency)', async () => {
    mockSelectWhere.mockReturnValueOnce({
      limit: vi.fn().mockResolvedValue([{ id: 'existing-txn' }]),
    });
    await reverseAddonTokens('user_abc', 'ch_dup', 500, 1000);
    expect(mockNeonTransaction).not.toHaveBeenCalled();
  });
});
