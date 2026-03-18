/**
 * DB-level tests for subscription-lifecycle webhook handlers.
 *
 * All database and service calls are mocked. Tests verify:
 * - Correct DB mutations (tier updates, token grants, adjustments)
 * - Audit transaction records
 * - Waterfall upgrade/downgrade logic
 * - Guard clauses (unknown customer, stale subscription IDs, past_due status)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User, Tier } from '../../db/schema';

// ---------------------------------------------------------------------------
// Mocks — registered before module imports
// ---------------------------------------------------------------------------

vi.mock('@/lib/tokens/pricing', () => ({
  TIER_MONTHLY_TOKENS: {
    starter: 50,
    hobbyist: 300,
    creator: 1000,
    pro: 3000,
  },
}));

// Mutable state controlled per-test
let mockUser: Partial<User> | null = null;
let mockUserAfterUpdate: Partial<User> | null = null;
let selectCallCount = 0;

const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
const mockUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
});

function buildSelectChain(rows: Partial<User>[]): unknown {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

const mockSelect = vi.fn().mockImplementation(() => {
  const isFirstCall = selectCallCount === 0;
  selectCallCount++;
  const user = isFirstCall ? mockUser : (mockUserAfterUpdate ?? mockUser);
  return buildSelectChain(user ? [user] : []);
});

const mockTransaction = vi.fn().mockImplementation(
  async (cb: (tx: unknown) => Promise<unknown>) => {
    return cb({ select: mockSelect, insert: mockInsert, update: mockUpdate });
  }
);

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    transaction: mockTransaction,
  }),
}));

vi.mock('@/lib/db/schema', () => ({
  users: {
    id: 'id',
    stripeCustomerId: 'stripeCustomerId',
    monthlyTokens: 'monthlyTokens',
    monthlyTokensUsed: 'monthlyTokensUsed',
    addonTokens: 'addonTokens',
    earnedCredits: 'earnedCredits',
  },
  creditTransactions: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => 'WHERE_CLAUSE'),
  sql: vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => 'SQL_EXPR'),
}));

// NOTE: vi.mock factories are hoisted before variable declarations, so we
// cannot reference outer `const` variables inside them. Use vi.fn() inline
// and access via vi.mocked() after the import.
vi.mock('@/lib/auth/user-service', () => ({
  updateUserTier: vi.fn().mockResolvedValue(undefined),
}));

import {
  findUserByStripeCustomer,
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
} from '../subscription-lifecycle';
import { updateUserTier } from '@/lib/auth/user-service';

// Typed reference to the mocked function for cleaner assertions
const mockUpdateUserTier = vi.mocked(updateUserTier);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<User> = {}): Partial<User> {
  return {
    id: 'user-uuid-1',
    clerkId: 'clerk_abc',
    email: 'test@example.com',
    displayName: 'Test User',
    tier: 'creator' as Tier,
    monthlyTokens: 1000,
    monthlyTokensUsed: 0,
    addonTokens: 0,
    earnedCredits: 0,
    stripeCustomerId: 'cus_abc123',
    stripeSubscriptionId: 'sub_xyz789',
    billingCycleStart: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function resetMocks(): void {
  vi.clearAllMocks();
  selectCallCount = 0;
  mockUser = null;
  mockUserAfterUpdate = null;

  mockSelect.mockImplementation(() => {
    const isFirstCall = selectCallCount === 0;
    selectCallCount++;
    const user = isFirstCall ? mockUser : (mockUserAfterUpdate ?? mockUser);
    return buildSelectChain(user ? [user] : []);
  });

  mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
  mockUpdate.mockReturnValue({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  });
  mockTransaction.mockImplementation(
    async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb({ select: mockSelect, insert: mockInsert, update: mockUpdate });
    }
  );
  mockUpdateUserTier.mockResolvedValue(undefined);
}

beforeEach(resetMocks);

// ---------------------------------------------------------------------------
// findUserByStripeCustomer
// ---------------------------------------------------------------------------

describe('findUserByStripeCustomer', () => {
  it('returns the user when found', async () => {
    mockUser = makeUser({ stripeCustomerId: 'cus_abc123' });
    const result = await findUserByStripeCustomer('cus_abc123');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('user-uuid-1');
  });

  it('returns null when no user has that Stripe customer ID', async () => {
    mockUser = null;
    const result = await findUserByStripeCustomer('cus_unknown');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleSubscriptionCreated
// ---------------------------------------------------------------------------

describe('handleSubscriptionCreated', () => {
  it('does nothing when customer ID is not found', async () => {
    mockUser = null;
    await handleSubscriptionCreated('cus_unknown', 'sub_new', 'creator');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdateUserTier).not.toHaveBeenCalled();
  });

  it('updates the user tier via updateUserTier', async () => {
    mockUser = makeUser({ tier: 'starter' as Tier });
    mockUserAfterUpdate = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000 });

    await handleSubscriptionCreated('cus_abc123', 'sub_new', 'creator');
    expect(mockUpdateUserTier).toHaveBeenCalledWith('user-uuid-1', 'creator');
  });

  it('writes correct monthly_grant to credit_transactions', async () => {
    mockUser = makeUser({ tier: 'hobbyist' as Tier });
    mockUserAfterUpdate = makeUser({ monthlyTokens: 300, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });

    await handleSubscriptionCreated('cus_abc123', 'sub_new', 'hobbyist');

    expect(mockInsert).toHaveBeenCalledOnce();
    const txn = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(txn.transactionType).toBe('monthly_grant');
    expect(txn.amount).toBe(300);
    expect(txn.source).toBe('subscription_created:hobbyist');
    expect(txn.referenceId).toBe('sub_new');
  });

  it('sets subscription ID and resets token counters on DB update', async () => {
    mockUser = makeUser({ tier: 'starter' as Tier, monthlyTokens: 50, monthlyTokensUsed: 30 });
    mockUserAfterUpdate = makeUser({ tier: 'pro' as Tier, monthlyTokens: 3000, monthlyTokensUsed: 0 });

    await handleSubscriptionCreated('cus_abc123', 'sub_new', 'pro');

    expect(mockUpdate).toHaveBeenCalledOnce();
    const setArg = mockUpdate.mock.results[0].value.set.mock.calls[0][0];
    expect(setArg.stripeSubscriptionId).toBe('sub_new');
    expect(setArg.monthlyTokens).toBe(3000);
    expect(setArg.monthlyTokensUsed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// handleSubscriptionUpdated
// ---------------------------------------------------------------------------

describe('handleSubscriptionUpdated — no tier change', () => {
  it('updates subscription ID without changing tokens when tier is unchanged', async () => {
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 500 });

    await handleSubscriptionUpdated('cus_abc123', 'sub_updated', 'creator', 'active');

    // update called once for subscription ID only
    expect(mockUpdate).toHaveBeenCalledOnce();
    // No audit transaction for token change
    expect(mockInsert).not.toHaveBeenCalled();
    // updateUserTier called to keep it in sync
    expect(mockUpdateUserTier).toHaveBeenCalledWith('user-uuid-1', 'creator');
  });

  it('skips token change when status is past_due', async () => {
    mockUser = makeUser({ tier: 'creator' as Tier });

    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'pro', 'past_due');

    expect(mockUpdate).toHaveBeenCalledOnce(); // only the subscriptionId update
    expect(mockUpdateUserTier).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('skips token change when status is unpaid', async () => {
    mockUser = makeUser({ tier: 'creator' as Tier });

    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'pro', 'unpaid');

    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockUpdateUserTier).not.toHaveBeenCalled();
  });
});

describe('handleSubscriptionUpdated — upgrade', () => {
  it('grants token difference immediately on upgrade (creator→pro)', async () => {
    // creator=1000, pro=3000; difference=2000
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 600 });
    // After update: remaining + difference tokens
    mockUserAfterUpdate = makeUser({ tier: 'pro' as Tier, monthlyTokens: 2400, monthlyTokensUsed: 0 });

    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'pro', 'active');

    // PF-513: updateUserTier moved inside transaction — tier is set via tx.update, not updateUserTier
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockInsert).toHaveBeenCalledOnce();
    const txn = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(txn.transactionType).toBe('adjustment');
    expect(txn.amount).toBe(2000); // difference = 3000 - 1000
    expect(txn.source).toBe('upgrade:creator->pro');
  });

  it('grants token difference on starter→hobbyist upgrade', async () => {
    // starter=50, hobbyist=300; difference=250
    mockUser = makeUser({ tier: 'starter' as Tier, monthlyTokens: 50, monthlyTokensUsed: 0 });
    mockUserAfterUpdate = makeUser({ tier: 'hobbyist' as Tier, monthlyTokens: 300, monthlyTokensUsed: 0 });

    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'hobbyist', 'active');

    const txn = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(txn.amount).toBe(250);
    expect(txn.source).toBe('upgrade:starter->hobbyist');
  });
});

describe('handleSubscriptionUpdated — downgrade', () => {
  it('caps monthly tokens to new allocation on downgrade (pro→creator)', async () => {
    // pro=3000, creator=1000; user had 3000 monthly — downgrade caps to 1000
    mockUser = makeUser({ tier: 'pro' as Tier, monthlyTokens: 3000, monthlyTokensUsed: 500 });
    mockUserAfterUpdate = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 0 });

    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'creator', 'active');

    // PF-513: tier is updated inside transaction via tx.update, not updateUserTier
    expect(mockUpdate).toHaveBeenCalled();
    // mockReturnValue returns the same mock object for all .update() calls,
    // so the shared .set mock accumulates calls: [0]=subscriptionId, [1]=tier (PF-513), [2]=tokens
    const sharedSet = mockUpdate.mock.results[0].value.set;
    const tokenSetArg = sharedSet.mock.calls[2][0];
    expect(tokenSetArg.monthlyTokens).toBe(1000);
    expect(tokenSetArg.monthlyTokensUsed).toBe(0);
  });

  it('records a negative adjustment amount on downgrade', async () => {
    // creator=1000, hobbyist=300; amount = 300 - 1000 = -700
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 0 });
    mockUserAfterUpdate = makeUser({ tier: 'hobbyist' as Tier, monthlyTokens: 300, monthlyTokensUsed: 0 });

    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'hobbyist', 'active');

    const txn = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(txn.amount).toBe(-700);
    expect(txn.source).toBe('downgrade:creator->hobbyist');
  });

  it('does nothing when customer is not found', async () => {
    mockUser = null;
    await handleSubscriptionUpdated('cus_unknown', 'sub_xyz', 'pro', 'active');
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleSubscriptionDeleted
// ---------------------------------------------------------------------------

describe('handleSubscriptionDeleted', () => {
  it('does nothing when customer is not found', async () => {
    mockUser = null;
    await handleSubscriptionDeleted('cus_unknown', 'sub_xyz');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('reverts user to starter tier', async () => {
    mockUser = makeUser({ tier: 'pro' as Tier });
    mockUserAfterUpdate = makeUser({ tier: 'starter' as Tier, monthlyTokens: 50 });

    await handleSubscriptionDeleted('cus_abc123', 'sub_xyz');
    expect(mockUpdateUserTier).toHaveBeenCalledWith('user-uuid-1', 'starter');
  });

  it('sets monthlyTokens to starter allocation and clears subscription ID', async () => {
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 400 });
    mockUserAfterUpdate = makeUser({ tier: 'starter' as Tier, monthlyTokens: 50, monthlyTokensUsed: 0 });

    await handleSubscriptionDeleted('cus_abc123', 'sub_xyz');

    const setArg = mockUpdate.mock.results[0].value.set.mock.calls[0][0];
    expect(setArg.stripeSubscriptionId).toBeNull();
    expect(setArg.monthlyTokens).toBe(50); // starter allocation
    expect(setArg.monthlyTokensUsed).toBe(0);
  });

  it('records a negative adjustment for the lost monthly tokens', async () => {
    // User had 1000 monthly, used 400 — remaining=600 lost
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 400 });
    mockUserAfterUpdate = makeUser({ tier: 'starter' as Tier, monthlyTokens: 50, monthlyTokensUsed: 0 });

    await handleSubscriptionDeleted('cus_abc123', 'sub_xyz');

    const txn = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(txn.transactionType).toBe('adjustment');
    expect(txn.amount).toBe(-600); // -(1000 - 400)
    expect(txn.source).toBe('cancellation:creator->starter');
    expect(txn.referenceId).toBe('sub_xyz');
  });

  it('records zero adjustment when all monthly tokens were already spent', async () => {
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 1000 });
    mockUserAfterUpdate = makeUser({ tier: 'starter' as Tier, monthlyTokens: 50, monthlyTokensUsed: 0 });

    await handleSubscriptionDeleted('cus_abc123', 'sub_xyz');

    const txn = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    // -Math.max(0, 0) produces -0 in JS; check the absolute value is zero
    expect(Math.abs(txn.amount)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// handleInvoicePaid
// ---------------------------------------------------------------------------

describe('handleInvoicePaid', () => {
  it('does nothing when subscriptionId is null (one-time payment)', async () => {
    await handleInvoicePaid('cus_abc123', 'inv_123', null);
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does nothing when customer is not found', async () => {
    mockUser = null;
    await handleInvoicePaid('cus_unknown', 'inv_123', 'sub_xyz');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('skips when subscription IDs do not match (stale event)', async () => {
    mockUser = makeUser({ stripeSubscriptionId: 'sub_current' });
    await handleInvoicePaid('cus_abc123', 'inv_123', 'sub_old');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('processes renewal when user has no subscription on file (new user flow)', async () => {
    // stripeSubscriptionId is null on user — allow renewal to proceed
    mockUser = makeUser({ stripeSubscriptionId: null, monthlyTokens: 1000, monthlyTokensUsed: 0 });
    mockUserAfterUpdate = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });

    await handleInvoicePaid('cus_abc123', 'inv_123', 'sub_xyz');
    // Monthly grant should always happen
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('rolls over unused tokens before granting new monthly allocation', async () => {
    // User has 400 remaining from previous cycle (1000 - 600 used)
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 600, addonTokens: 0, stripeSubscriptionId: 'sub_xyz' });
    mockUserAfterUpdate = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 400, earnedCredits: 0 });

    await handleInvoicePaid('cus_abc123', 'inv_123', 'sub_xyz');

    // First update = rollover to addon, second = monthly grant
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    // Two transactions: rollover + monthly_grant.
    // mockInsert returns the same object each call, so the shared .values
    // mock accumulates all calls: [0]=rollover, [1]=monthly_grant.
    expect(mockInsert).toHaveBeenCalledTimes(2);
    const sharedValues = mockInsert.mock.results[0].value.values;
    const rolloverTxn = sharedValues.mock.calls[0][0];
    const grantTxn = sharedValues.mock.calls[1][0];
    expect(rolloverTxn.transactionType).toBe('rollover');
    expect(rolloverTxn.amount).toBe(400);
    expect(grantTxn.transactionType).toBe('monthly_grant');
    expect(grantTxn.amount).toBe(1000);
  });

  it('caps rollover at tier monthly allocation when remaining exceeds it', async () => {
    // Creator tier cap = 1000; somehow 1500 remaining — capped at 1000
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 2000, monthlyTokensUsed: 500, addonTokens: 0, stripeSubscriptionId: 'sub_xyz' });
    mockUserAfterUpdate = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 1000, earnedCredits: 0 });

    await handleInvoicePaid('cus_abc123', 'inv_123', 'sub_xyz');

    const rolloverTxn = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(rolloverTxn.amount).toBe(1000); // capped at creator allocation
  });

  it('skips rollover transaction when no monthly tokens remain', async () => {
    // User spent all tokens — no rollover
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 1000, addonTokens: 0, stripeSubscriptionId: 'sub_xyz' });
    mockUserAfterUpdate = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });

    await handleInvoicePaid('cus_abc123', 'inv_123', 'sub_xyz');

    // Only one DB update and one transaction (monthly grant only)
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockInsert).toHaveBeenCalledOnce();
    const txn = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(txn.transactionType).toBe('monthly_grant');
  });

  it('grants correct token allocation for each tier on renewal', async () => {
    const cases: Array<[Tier, number]> = [
      ['starter', 50],
      ['hobbyist', 300],
      ['creator', 1000],
      ['pro', 3000],
    ];

    for (const [tier, allocation] of cases) {
      resetMocks();
      mockUser = makeUser({ tier, monthlyTokens: allocation, monthlyTokensUsed: allocation, stripeSubscriptionId: 'sub_xyz' });
      mockUserAfterUpdate = makeUser({ tier, monthlyTokens: allocation, monthlyTokensUsed: 0 });

      await handleInvoicePaid('cus_abc123', 'inv_123', 'sub_xyz');

      const txn = mockInsert.mock.results[0].value.values.mock.calls[0][0];
      expect(txn.transactionType, `tier=${tier}`).toBe('monthly_grant');
      expect(txn.amount, `tier=${tier}`).toBe(allocation);
    }
  });

  it('resets billing cycle start on successful renewal', async () => {
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 1000, stripeSubscriptionId: 'sub_xyz' });
    mockUserAfterUpdate = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0 });

    await handleInvoicePaid('cus_abc123', 'inv_123', 'sub_xyz');

    // The monthly grant update includes billingCycleStart
    const lastUpdateIndex = mockUpdate.mock.results.length - 1;
    const setArg = mockUpdate.mock.results[lastUpdateIndex].value.set.mock.calls[0][0];
    expect(setArg.billingCycleStart).toBeInstanceOf(Date);
    expect(setArg.monthlyTokensUsed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// handleInvoicePaymentFailed
// ---------------------------------------------------------------------------

describe('handleInvoicePaymentFailed', () => {
  it('does nothing when customer is not found', async () => {
    mockUser = null;
    await handleInvoicePaymentFailed('cus_unknown', 'inv_123', 1, null);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('records an audit transaction with amount=0 (informational only)', async () => {
    mockUser = makeUser();
    mockUserAfterUpdate = makeUser();

    await handleInvoicePaymentFailed('cus_abc123', 'inv_123', 1, null);

    expect(mockInsert).toHaveBeenCalledOnce();
    const txn = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(txn.transactionType).toBe('adjustment');
    expect(txn.amount).toBe(0);
    expect(txn.source).toBe('payment_failed:attempt_1');
    expect(txn.referenceId).toBe('inv_123');
  });

  it('does NOT change the user tier on payment failure', async () => {
    mockUser = makeUser({ tier: 'pro' as Tier });
    mockUserAfterUpdate = makeUser({ tier: 'pro' as Tier });

    await handleInvoicePaymentFailed('cus_abc123', 'inv_123', 2, new Date());

    expect(mockUpdateUserTier).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('encodes attempt count in transaction source', async () => {
    mockUser = makeUser();
    mockUserAfterUpdate = makeUser();

    await handleInvoicePaymentFailed('cus_abc123', 'inv_123', 3, null);

    const txn = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(txn.source).toBe('payment_failed:attempt_3');
  });

  it('handles nextPaymentAttempt=null gracefully (final retry)', async () => {
    mockUser = makeUser();
    mockUserAfterUpdate = makeUser();
    await expect(
      handleInvoicePaymentFailed('cus_abc123', 'inv_final', 4, null)
    ).resolves.not.toThrow();
  });

  it('handles a future nextPaymentAttempt date without errors', async () => {
    mockUser = makeUser();
    mockUserAfterUpdate = makeUser();
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    await expect(
      handleInvoicePaymentFailed('cus_abc123', 'inv_123', 1, future)
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Transaction safety (PF-487)
// ---------------------------------------------------------------------------

describe('handleSubscriptionUpdated — transaction safety', () => {
  it('wraps tier change token adjustment in a db transaction', async () => {
    mockUser = makeUser({ tier: 'pro' as Tier, monthlyTokens: 3000, monthlyTokensUsed: 0 });
    mockUserAfterUpdate = makeUser({ tier: 'starter' as Tier, monthlyTokens: 50, monthlyTokensUsed: 0 });

    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'starter', 'active');
    expect(mockTransaction).toHaveBeenCalledOnce();
    // PF-513: 3 updates: subscriptionId + tier (inside tx) + token adjustment (inside tx)
    expect(mockUpdate).toHaveBeenCalledTimes(3);
    expect(mockInsert).toHaveBeenCalledOnce();
  });

  it('concurrent operations cannot produce negative balance because of transaction wrapping', async () => {
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 900, addonTokens: 0, earnedCredits: 0 });
    mockUserAfterUpdate = makeUser({ tier: 'hobbyist' as Tier, monthlyTokens: 300, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });

    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'hobbyist', 'active');

    expect(mockTransaction).toHaveBeenCalledOnce();
    const txn = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(txn.balanceAfter).toBeGreaterThanOrEqual(0);
  });

  it('does not wrap in transaction when tier is unchanged', async () => {
    mockUser = makeUser({ tier: 'creator' as Tier });

    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'creator', 'active');

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('does not wrap in transaction for past_due status', async () => {
    mockUser = makeUser({ tier: 'creator' as Tier });

    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'pro', 'past_due');

    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
