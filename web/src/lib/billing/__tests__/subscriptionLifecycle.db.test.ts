/**
 * DB-level tests for subscription-lifecycle webhook handlers.
 *
 * PF-77: All multi-statement mutations now use neonSql.transaction() for
 * atomicity. These tests verify:
 * - Correct neonSql.transaction() calls (atomicity)
 * - Correct SQL parameter values (tier, tokens, amounts)
 * - Audit transaction records (balanceAfter computed from snapshot)
 * - Guard clauses (unknown customer, stale subscription IDs, past_due status)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User, Tier } from '../../db/schema';

// ---------------------------------------------------------------------------
// Mocks — registered before module imports
// ---------------------------------------------------------------------------

vi.mock('server-only', () => ({}));

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
let selectCallCount = 0;

// Drizzle ORM mock (used for SELECT reads only)
const mockInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue([]) }),
});
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
  selectCallCount++;
  return buildSelectChain(mockUser ? [mockUser] : []);
});

const mockDb = { select: mockSelect, insert: mockInsert, update: mockUpdate };

// Neon SQL mock — tagged template function with .transaction()
interface MockStatement {
  _type: 'neon_statement';
  values: unknown[];
}

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
  queryWithResilience: vi.fn((fn: () => Promise<unknown>) => fn()),
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
  creditTransactions: { id: 'id', userId: 'userId', referenceId: 'referenceId', source: 'source' },
  tokenPurchases: { userId: 'userId', stripePaymentIntent: 'stripePaymentIntent', id: 'id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => 'WHERE_CLAUSE'),
  and: vi.fn((..._args: unknown[]) => 'AND_CLAUSE'),
}));

import {
  findUserByStripeCustomer,
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
} from '../subscription-lifecycle';

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

  mockSelect.mockImplementation(() => {
    selectCallCount++;
    return buildSelectChain(mockUser ? [mockUser] : []);
  });

  mockInsert.mockReturnValue({
    values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue([]) }),
  });
  mockUpdate.mockReturnValue({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  });
  mockNeonTransaction.mockResolvedValue([]);
  mockNeonSql.mockImplementation(
    (_strings: TemplateStringsArray, ..._values: unknown[]): MockStatement => ({
      _type: 'neon_statement',
      values: _values,
    }),
  );
}

/** Get the values interpolated into the N-th neonSql template literal call */
function neonCallValues(callIndex: number): unknown[] {
  return mockNeonSql.mock.calls[callIndex]?.slice(1).flat() ?? [];
}

/** Get the number of statements passed to the N-th transaction call */
function transactionStatementCount(txnIndex = 0): number {
  const args = mockNeonTransaction.mock.calls[txnIndex];
  return args ? (args[0] as MockStatement[]).length : 0;
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
    expect(mockNeonTransaction).not.toHaveBeenCalled();
  });

  it('wraps tier update + token grant in a single neonSql.transaction (PF-77)', async () => {
    mockUser = makeUser({ tier: 'starter' as Tier });
    await handleSubscriptionCreated('cus_abc123', 'sub_new', 'creator');
    expect(mockNeonTransaction).toHaveBeenCalledOnce();
    expect(transactionStatementCount()).toBe(2); // UPDATE users + INSERT credit_transactions
  });

  it('passes correct tier and allocation to SQL', async () => {
    mockUser = makeUser({ tier: 'hobbyist' as Tier, addonTokens: 100, earnedCredits: 50 });
    await handleSubscriptionCreated('cus_abc123', 'sub_new', 'hobbyist');

    // Call 0 = UPDATE users, Call 1 = INSERT...SELECT credit_transactions
    const updateValues = neonCallValues(0);
    expect(updateValues).toContain('hobbyist'); // tier
    expect(updateValues).toContain(300); // allocation (hobbyist)
    expect(updateValues).toContain('sub_new'); // subscriptionId
    expect(updateValues).toContain('user-uuid-1'); // userId

    // INSERT...SELECT: balanceAfter computed in SQL (allocation + addon_tokens + earned_credits)
    // Interpolated values: userId, amount(allocation), allocation(for balance calc), source, referenceId, userId(WHERE)
    const insertValues = neonCallValues(1);
    expect(insertValues).toContain('user-uuid-1');
    expect(insertValues).toContain(300); // amount = allocation
    expect(insertValues).toContain('subscription_created:hobbyist');
    expect(insertValues).toContain('sub_new');
  });

  it('does NOT call updateUserTier separately (tier is in the transaction)', async () => {
    mockUser = makeUser({ tier: 'starter' as Tier });
    await handleSubscriptionCreated('cus_abc123', 'sub_new', 'pro');
    // No separate Drizzle update for tier — it's in the neonSql transaction
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleSubscriptionUpdated
// ---------------------------------------------------------------------------

describe('handleSubscriptionUpdated — no tier change', () => {
  it('updates subscription ID without transaction when tier is unchanged', async () => {
    mockUser = makeUser({ tier: 'creator' as Tier });
    await handleSubscriptionUpdated('cus_abc123', 'sub_updated', 'creator', 'active');
    expect(mockNeonTransaction).not.toHaveBeenCalled();
    // Single neonSql call for UPDATE (not a transaction, just a plain statement)
    expect(mockNeonSql).toHaveBeenCalled();
  });

  it('skips token change when status is past_due', async () => {
    mockUser = makeUser({ tier: 'creator' as Tier });
    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'pro', 'past_due');
    expect(mockNeonTransaction).not.toHaveBeenCalled();
  });

  it('skips token change when status is unpaid', async () => {
    mockUser = makeUser({ tier: 'creator' as Tier });
    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'pro', 'unpaid');
    expect(mockNeonTransaction).not.toHaveBeenCalled();
  });
});

describe('handleSubscriptionUpdated — upgrade', () => {
  it('uses neonSql.transaction for tier change (PF-77)', async () => {
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 600 });
    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'pro', 'active');
    expect(mockNeonTransaction).toHaveBeenCalledOnce();
    expect(transactionStatementCount()).toBe(2); // UPDATE users + INSERT credit_transactions
  });

  it('grants token difference immediately on upgrade (creator→pro)', async () => {
    // creator=1000, pro=3000; difference=2000
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 600, addonTokens: 50, earnedCredits: 10 });
    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'pro', 'active');

    // INSERT...SELECT: balanceAfter computed in SQL, not interpolated
    const allCalls = mockNeonSql.mock.calls;
    const insertCall = allCalls[allCalls.length - 1];
    const insertValues = insertCall.slice(1).flat();
    expect(insertValues).toContain(2000); // difference = 3000 - 1000
    expect(insertValues).toContain('upgrade:creator->pro');
    // balanceAfter is computed in SQL via GREATEST(0, monthly_tokens - monthly_tokens_used) + addon_tokens + earned_credits
  });

  it('grants token difference on starter→hobbyist upgrade', async () => {
    // starter=50, hobbyist=300; difference=250; remaining=50
    mockUser = makeUser({ tier: 'starter' as Tier, monthlyTokens: 50, monthlyTokensUsed: 0 });
    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'hobbyist', 'active');

    const allCalls = mockNeonSql.mock.calls;
    const insertCall = allCalls[allCalls.length - 1];
    const insertValues = insertCall.slice(1).flat();
    expect(insertValues).toContain(250); // difference
    expect(insertValues).toContain('upgrade:starter->hobbyist');
  });
});

describe('handleSubscriptionUpdated — downgrade', () => {
  it('caps monthly tokens to new allocation on downgrade (pro→creator)', async () => {
    mockUser = makeUser({ tier: 'pro' as Tier, monthlyTokens: 3000, monthlyTokensUsed: 500 });
    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'creator', 'active');

    expect(mockNeonTransaction).toHaveBeenCalledOnce();
    // UPDATE should set monthly_tokens = 1000 (creator allocation)
    const updateValues = neonCallValues(0);
    expect(updateValues).toContain('creator');
    expect(updateValues).toContain(1000); // newAllocation
  });

  it('records a negative adjustment amount on downgrade', async () => {
    // creator=1000, hobbyist=300; amount = 300 - 1000 = -700
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 0 });
    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'hobbyist', 'active');

    const allCalls = mockNeonSql.mock.calls;
    const insertCall = allCalls[allCalls.length - 1];
    const insertValues = insertCall.slice(1).flat();
    expect(insertValues).toContain(-700); // 300 - 1000
    expect(insertValues).toContain('downgrade:creator->hobbyist');
  });

  it('does nothing when customer is not found', async () => {
    mockUser = null;
    await handleSubscriptionUpdated('cus_unknown', 'sub_xyz', 'pro', 'active');
    expect(mockNeonSql).not.toHaveBeenCalled();
    expect(mockNeonTransaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleSubscriptionDeleted
// ---------------------------------------------------------------------------

describe('handleSubscriptionDeleted', () => {
  it('does nothing when customer is not found', async () => {
    mockUser = null;
    await handleSubscriptionDeleted('cus_unknown', 'sub_xyz');
    expect(mockNeonTransaction).not.toHaveBeenCalled();
  });

  it('wraps tier revert + audit in a single transaction (PF-77)', async () => {
    mockUser = makeUser({ tier: 'pro' as Tier });
    await handleSubscriptionDeleted('cus_abc123', 'sub_xyz');
    expect(mockNeonTransaction).toHaveBeenCalledOnce();
    expect(transactionStatementCount()).toBe(2); // UPDATE users + INSERT credit_transactions
  });

  it('sets starter allocation and clears subscription ID', async () => {
    mockUser = makeUser({ tier: 'creator' as Tier });
    await handleSubscriptionDeleted('cus_abc123', 'sub_xyz');

    // 'starter' is a SQL literal, not interpolated. Check interpolated values:
    const updateValues = neonCallValues(0);
    expect(updateValues).toContain(50); // starter allocation (interpolated)
    expect(updateValues).toContain('user-uuid-1'); // userId
  });

  it('records a negative adjustment for the lost monthly tokens', async () => {
    // User had 1000 monthly, used 400 — remaining=600 lost
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 400, addonTokens: 200, earnedCredits: 0 });
    await handleSubscriptionDeleted('cus_abc123', 'sub_xyz');

    // INSERT runs BEFORE UPDATE so it reads pre-cancellation state
    const allCalls = mockNeonSql.mock.calls;
    const insertCall = allCalls[0]; // first call is the INSERT
    const insertValues = insertCall.slice(1).flat();
    expect(insertValues).toContain('cancellation:creator->starter');
    expect(insertValues).toContain(50); // starter allocation (for balance calc)
  });

  it('records adjustment when all monthly tokens were already spent', async () => {
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 1000 });
    await handleSubscriptionDeleted('cus_abc123', 'sub_xyz');

    // INSERT...SELECT: -GREATEST(0, monthly_tokens - monthly_tokens_used) computed in SQL
    expect(mockNeonTransaction).toHaveBeenCalledOnce();
    expect(transactionStatementCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// handleInvoicePaid
// ---------------------------------------------------------------------------

describe('handleInvoicePaid', () => {
  it('does nothing when subscriptionId is null (one-time payment)', async () => {
    await handleInvoicePaid('cus_abc123', 'inv_123', null);
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockNeonTransaction).not.toHaveBeenCalled();
  });

  it('does nothing when customer is not found', async () => {
    mockUser = null;
    await handleInvoicePaid('cus_unknown', 'inv_123', 'sub_xyz');
    expect(mockNeonTransaction).not.toHaveBeenCalled();
  });

  it('skips when subscription IDs do not match (stale event)', async () => {
    mockUser = makeUser({ stripeSubscriptionId: 'sub_current' });
    await handleInvoicePaid('cus_abc123', 'inv_123', 'sub_old');
    expect(mockNeonTransaction).not.toHaveBeenCalled();
  });

  it('wraps all renewal mutations in a single transaction (PF-77)', async () => {
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 600, stripeSubscriptionId: 'sub_xyz' });
    await handleInvoicePaid('cus_abc123', 'inv_123', 'sub_xyz');
    expect(mockNeonTransaction).toHaveBeenCalledOnce();
    // With rollover: UPDATE addon + INSERT rollover + UPDATE monthly + INSERT grant = 4 statements
    expect(transactionStatementCount()).toBe(4);
  });

  it('rolls over unused tokens before granting new monthly allocation', async () => {
    // User has 400 remaining from previous cycle (1000 - 600 used)
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 600, addonTokens: 100, earnedCredits: 0, stripeSubscriptionId: 'sub_xyz' });
    await handleInvoicePaid('cus_abc123', 'inv_123', 'sub_xyz');

    // With rollover: 4 statements (INSERT rollover, UPDATE addon, UPDATE monthly, INSERT grant)
    expect(transactionStatementCount()).toBe(4);

    // Check rollover INSERT...SELECT has correct source (runs BEFORE addon UPDATE)
    const allCalls = mockNeonSql.mock.calls;
    const rolloverInsertValues = allCalls[0].slice(1).flat();
    expect(rolloverInsertValues).toContain('renewal_rollover:creator');

    // Check grant INSERT...SELECT has correct source and allocation
    const grantInsertValues = allCalls[3].slice(1).flat();
    expect(grantInsertValues).toContain(1000); // creator allocation
    expect(grantInsertValues).toContain('renewal:creator');
  });

  it('caps rollover at tier monthly allocation when remaining exceeds it', async () => {
    // Creator tier cap = 1000; somehow 1500 remaining — capped at 1000
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 2000, monthlyTokensUsed: 500, addonTokens: 0, stripeSubscriptionId: 'sub_xyz' });
    await handleInvoicePaid('cus_abc123', 'inv_123', 'sub_xyz');

    const rolloverInsertValues = mockNeonSql.mock.calls[0].slice(1).flat();
    expect(rolloverInsertValues).toContain(1000); // capped at creator allocation
  });

  it('skips rollover statements when no monthly tokens remain', async () => {
    // User spent all tokens — no rollover
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 1000, addonTokens: 0, stripeSubscriptionId: 'sub_xyz' });
    await handleInvoicePaid('cus_abc123', 'inv_123', 'sub_xyz');

    // Only monthly reset + grant = 2 statements (no rollover)
    expect(transactionStatementCount()).toBe(2);
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
      await handleInvoicePaid('cus_abc123', 'inv_123', 'sub_xyz');

      // With all tokens used: 2 statements (reset + grant)
      const grantInsertValues = mockNeonSql.mock.calls[1].slice(1).flat();
      expect(grantInsertValues, `tier=${tier}`).toContain(allocation);
      expect(grantInsertValues, `tier=${tier}`).toContain(`renewal:${tier}`);
    }
  });

  it('processes renewal when user has no subscription on file (new user flow)', async () => {
    mockUser = makeUser({ stripeSubscriptionId: null, monthlyTokens: 1000, monthlyTokensUsed: 0 });
    await handleInvoicePaid('cus_abc123', 'inv_123', 'sub_xyz');
    expect(mockNeonTransaction).toHaveBeenCalledOnce();
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
    await handleInvoicePaymentFailed('cus_abc123', 'inv_123', 2, new Date());
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockNeonTransaction).not.toHaveBeenCalled();
  });

  it('encodes attempt count in transaction source', async () => {
    mockUser = makeUser();
    await handleInvoicePaymentFailed('cus_abc123', 'inv_123', 3, null);

    const txn = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(txn.source).toBe('payment_failed:attempt_3');
  });

  it('uses onConflictDoNothing for idempotent retry safety (#8261)', async () => {
    mockUser = makeUser();
    await handleInvoicePaymentFailed('cus_abc123', 'inv_123', 1, null);

    // The insert chain must call onConflictDoNothing() to be idempotent
    const valuesResult = mockInsert.mock.results[0].value.values.mock.results[0].value;
    expect(valuesResult.onConflictDoNothing).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Transaction safety (PF-77)
// ---------------------------------------------------------------------------

describe('transaction atomicity (PF-77)', () => {
  it('handleSubscriptionCreated: all mutations in single transaction', async () => {
    mockUser = makeUser({ tier: 'starter' as Tier });
    await handleSubscriptionCreated('cus_abc123', 'sub_xyz', 'pro');
    expect(mockNeonTransaction).toHaveBeenCalledOnce();
    // No separate Drizzle updates
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('handleSubscriptionDeleted: all mutations in single transaction', async () => {
    mockUser = makeUser({ tier: 'pro' as Tier });
    await handleSubscriptionDeleted('cus_abc123', 'sub_xyz');
    expect(mockNeonTransaction).toHaveBeenCalledOnce();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('handleInvoicePaid: rollover + reset + grant in single transaction', async () => {
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 200, stripeSubscriptionId: 'sub_xyz' });
    await handleInvoicePaid('cus_abc123', 'inv_123', 'sub_xyz');
    expect(mockNeonTransaction).toHaveBeenCalledOnce();
    // Rollover: 4 statements (UPDATE addon + INSERT rollover + UPDATE monthly + INSERT grant)
    expect(transactionStatementCount()).toBe(4);
  });

  it('handleSubscriptionUpdated upgrade: uses neonSql.transaction not db.transaction', async () => {
    mockUser = makeUser({ tier: 'creator' as Tier, monthlyTokens: 1000, monthlyTokensUsed: 0 });
    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'pro', 'active');
    expect(mockNeonTransaction).toHaveBeenCalledOnce();
  });

  it('handleSubscriptionUpdated downgrade: uses neonSql.transaction not db.transaction', async () => {
    mockUser = makeUser({ tier: 'pro' as Tier, monthlyTokens: 3000, monthlyTokensUsed: 0 });
    await handleSubscriptionUpdated('cus_abc123', 'sub_xyz', 'creator', 'active');
    expect(mockNeonTransaction).toHaveBeenCalledOnce();
  });

  it('balanceAfter is computed in SQL (INSERT...SELECT), not from a stale JS snapshot', async () => {
    mockUser = makeUser({ tier: 'starter' as Tier, addonTokens: 200, earnedCredits: 50 });
    await handleSubscriptionCreated('cus_abc123', 'sub_new', 'pro');

    // balanceAfter is now computed via INSERT...SELECT (allocation + addon_tokens + earned_credits)
    // so it reads current DB state at execution time, not a stale JS snapshot.
    // The allocation (3000) IS interpolated; addon_tokens and earned_credits are SQL column refs.
    const allCalls = mockNeonSql.mock.calls;
    const insertValues = allCalls[1].slice(1).flat();
    expect(insertValues).toContain(3000); // allocation interpolated into SQL
    // No extra SELECT calls after findUserByStripeCustomer
    expect(selectCallCount).toBe(1);
  });
});
