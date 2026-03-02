import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '../../db/schema';

// ---------------------------------------------------------------------------
// Mock the DB client — must be done before any import of the module under test
// ---------------------------------------------------------------------------

// Mutable state that individual tests override
let mockUser: Partial<User> | null = null;
// Updated balance that getBalance reads after a mutation
let mockUserAfterUpdate: Partial<User> | null = null;

const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
const mockUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
});

function buildSelectChain(rows: Partial<User>[]): unknown {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

// selectCallCount tracks how many times select() has been called so the
// second call (inside getBalance after update) can return the updated user.
let selectCallCount = 0;

const mockSelect = vi.fn().mockImplementation(() => {
  const isFirstCall = selectCallCount === 0;
  selectCallCount++;
  const user = isFirstCall ? mockUser : (mockUserAfterUpdate ?? mockUser);
  return buildSelectChain(user ? [user] : []);
});

vi.mock('../../db/client', () => ({
  getDb: () => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  }),
}));

// Mock schema so eq/sql import paths resolve without a real DB
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => 'WHERE_CLAUSE'),
  sql: vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => 'SQL_EXPR'),
}));

vi.mock('../../db/schema', () => ({
  users: { id: 'id', monthlyTokensUsed: 'monthlyTokensUsed', addonTokens: 'addonTokens', earnedCredits: 'earnedCredits' },
  creditTransactions: {},
}));

vi.mock('../../tokens/pricing', () => ({
  TIER_MONTHLY_TOKENS: {
    starter: 50,
    hobbyist: 300,
    creator: 1000,
    pro: 3000,
  },
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are registered
// ---------------------------------------------------------------------------
import { getBalance, deductCredits, grantMonthlyCredits, processRollover } from '../creditManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<User> = {}): Partial<User> {
  return {
    id: 'user-uuid-1',
    clerkId: 'clerk_abc',
    email: 'test@example.com',
    displayName: 'Test User',
    tier: 'creator',
    monthlyTokens: 1000,
    monthlyTokensUsed: 0,
    addonTokens: 0,
    earnedCredits: 0,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    billingCycleStart: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectCallCount = 0;
  mockUser = null;
  mockUserAfterUpdate = null;

  // Re-wire the select mock after clearAllMocks
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
});

// ---------------------------------------------------------------------------
// getBalance
// ---------------------------------------------------------------------------

describe('getBalance', () => {
  it('returns zero pools for a brand-new user with no tokens', async () => {
    mockUser = makeUser({ monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });
    const balance = await getBalance('user-uuid-1');
    expect(balance).toEqual({ monthly: 0, purchased: 0, earned: 0, total: 0 });
  });

  it('computes monthly remaining as allocation minus used', async () => {
    mockUser = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 600, addonTokens: 0, earnedCredits: 0 });
    const balance = await getBalance('user-uuid-1');
    expect(balance.monthly).toBe(400);
    expect(balance.total).toBe(400);
  });

  it('clamps monthly to 0 when used exceeds allocation (data integrity guard)', async () => {
    mockUser = makeUser({ monthlyTokens: 100, monthlyTokensUsed: 150, addonTokens: 0, earnedCredits: 0 });
    const balance = await getBalance('user-uuid-1');
    expect(balance.monthly).toBe(0);
    expect(balance.total).toBe(0);
  });

  it('includes all three pools in total', async () => {
    mockUser = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 500, addonTokens: 200, earnedCredits: 50 });
    const balance = await getBalance('user-uuid-1');
    expect(balance.monthly).toBe(500);
    expect(balance.purchased).toBe(200);
    expect(balance.earned).toBe(50);
    expect(balance.total).toBe(750);
  });

  it('throws when user does not exist', async () => {
    mockUser = null;
    await expect(getBalance('nonexistent')).rejects.toThrow('User not found: nonexistent');
  });
});

// ---------------------------------------------------------------------------
// deductCredits — happy paths (waterfall order)
// ---------------------------------------------------------------------------

describe('deductCredits — waterfall deduction', () => {
  it('returns success=true immediately for amount=0 without touching DB', async () => {
    mockUser = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });
    // For the getBalance call inside the amount<=0 branch
    selectCallCount = 0;

    const result = await deductCredits('user-uuid-1', 0, 'chat');
    expect(result.success).toBe(true);
    // update should NOT be called because amount === 0
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns success=true immediately for negative amount without touching DB', async () => {
    mockUser = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0 });
    selectCallCount = 0;

    const result = await deductCredits('user-uuid-1', -5, 'chat');
    expect(result.success).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('deducts entirely from monthly pool when monthly balance is sufficient', async () => {
    mockUser = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });
    // After update, simulate used increasing
    mockUserAfterUpdate = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 50, addonTokens: 0, earnedCredits: 0 });

    const result = await deductCredits('user-uuid-1', 50, 'chat');
    expect(result.success).toBe(true);

    // Verify the update was called (monthly deduction)
    expect(mockUpdate).toHaveBeenCalledOnce();
    const setCalls = mockUpdate.mock.results[0].value.set.mock.calls;
    expect(setCalls.length).toBe(1);
  });

  it('spills into purchased tokens after exhausting monthly', async () => {
    // Monthly has 30 remaining, need 50 — spills 20 into addon
    mockUser = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 970, addonTokens: 100, earnedCredits: 0 });
    mockUserAfterUpdate = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 1000, addonTokens: 80, earnedCredits: 0 });

    const result = await deductCredits('user-uuid-1', 50, 'texture');
    expect(result.success).toBe(true);
    // Both monthly and addon should be touched in one update call
    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it('spills into earned credits as last resort', async () => {
    // Monthly=0, addon=0, earned=200 — full deduction from earned
    mockUser = makeUser({ monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 200 });
    mockUserAfterUpdate = makeUser({ monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 100 });

    const result = await deductCredits('user-uuid-1', 100, 'skybox');
    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it('deducts across all three pools when each is partially used', async () => {
    // monthly=20 remaining, addon=10, earned=5 — deduct 35 total
    mockUser = makeUser({ monthlyTokens: 100, monthlyTokensUsed: 80, addonTokens: 10, earnedCredits: 5 });
    mockUserAfterUpdate = makeUser({ monthlyTokens: 100, monthlyTokensUsed: 100, addonTokens: 0, earnedCredits: 0 });

    const result = await deductCredits('user-uuid-1', 35, 'voice');
    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// deductCredits — insufficient balance
// ---------------------------------------------------------------------------

describe('deductCredits — insufficient balance', () => {
  it('returns success=false when total balance is less than amount', async () => {
    mockUser = makeUser({ monthlyTokens: 50, monthlyTokensUsed: 40, addonTokens: 0, earnedCredits: 0 });

    const result = await deductCredits('user-uuid-1', 100, 'music');
    expect(result.success).toBe(false);
    // No DB mutation should happen when balance is insufficient
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('returns correct remaining balance in the failure response', async () => {
    mockUser = makeUser({ monthlyTokens: 100, monthlyTokensUsed: 95, addonTokens: 3, earnedCredits: 0 });

    const result = await deductCredits('user-uuid-1', 20, 'chat');
    expect(result.success).toBe(false);
    expect(result.balance.monthly).toBe(5);
    expect(result.balance.purchased).toBe(3);
    expect(result.balance.earned).toBe(0);
    expect(result.balance.total).toBe(8);
  });

  it('returns success=false when all pools are zero', async () => {
    mockUser = makeUser({ monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });

    const result = await deductCredits('user-uuid-1', 1, 'chat');
    expect(result.success).toBe(false);
  });

  it('boundary: exact balance equals amount — should succeed', async () => {
    mockUser = makeUser({ monthlyTokens: 50, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });
    mockUserAfterUpdate = makeUser({ monthlyTokens: 50, monthlyTokensUsed: 50, addonTokens: 0, earnedCredits: 0 });

    const result = await deductCredits('user-uuid-1', 50, 'chat');
    expect(result.success).toBe(true);
  });

  it('boundary: amount exceeds total by one — should fail', async () => {
    mockUser = makeUser({ monthlyTokens: 50, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });

    const result = await deductCredits('user-uuid-1', 51, 'chat');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deductCredits — error handling
// ---------------------------------------------------------------------------

describe('deductCredits — error handling', () => {
  it('throws when user not found', async () => {
    mockUser = null;

    await expect(deductCredits('ghost', 10, 'chat')).rejects.toThrow('User not found: ghost');
  });

  it('writes an audit transaction on successful deduction', async () => {
    mockUser = makeUser({ monthlyTokens: 100, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });
    mockUserAfterUpdate = makeUser({ monthlyTokens: 100, monthlyTokensUsed: 10, addonTokens: 0, earnedCredits: 0 });

    await deductCredits('user-uuid-1', 10, 'chat_standard');

    expect(mockInsert).toHaveBeenCalledOnce();
    const insertValues = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(insertValues.transactionType).toBe('deduction');
    expect(insertValues.amount).toBe(-10);
    expect(insertValues.source).toBe('chat_standard');
    expect(insertValues.userId).toBe('user-uuid-1');
  });
});

// ---------------------------------------------------------------------------
// grantMonthlyCredits
// ---------------------------------------------------------------------------

describe('grantMonthlyCredits', () => {
  it('sets monthlyTokens to tier allocation and resets used counter', async () => {
    mockUser = makeUser({ monthlyTokens: 300, monthlyTokensUsed: 150, addonTokens: 0, earnedCredits: 0 });
    mockUserAfterUpdate = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });

    await grantMonthlyCredits('user-uuid-1', 'creator');

    expect(mockUpdate).toHaveBeenCalledOnce();
    const setArg = mockUpdate.mock.results[0].value.set.mock.calls[0][0];
    expect(setArg.monthlyTokens).toBe(1000);
    expect(setArg.monthlyTokensUsed).toBe(0);
  });

  it('grants correct token count for each tier', async () => {
    const tiers: Array<[string, number]> = [
      ['starter', 50],
      ['hobbyist', 300],
      ['creator', 1000],
      ['pro', 3000],
    ];

    for (const [tier, expected] of tiers) {
      vi.clearAllMocks();
      selectCallCount = 0;
      mockSelect.mockImplementation(() => {
        const isFirstCall = selectCallCount === 0;
        selectCallCount++;
        const user = isFirstCall
          ? makeUser({ monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 })
          : makeUser({ monthlyTokens: expected, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });
        return buildSelectChain([user]);
      });
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      });
      mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });

      await grantMonthlyCredits('user-uuid-1', tier);
      const setArg = mockUpdate.mock.results[0].value.set.mock.calls[0][0];
      expect(setArg.monthlyTokens, `tier=${tier}`).toBe(expected);
    }
  });

  it('uses 0 tokens for an unknown tier ID (graceful fallback)', async () => {
    mockUser = makeUser({ monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });
    mockUserAfterUpdate = makeUser({ monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });

    await grantMonthlyCredits('user-uuid-1', 'enterprise');

    const setArg = mockUpdate.mock.results[0].value.set.mock.calls[0][0];
    expect(setArg.monthlyTokens).toBe(0);
  });

  it('writes a monthly_grant audit transaction', async () => {
    mockUser = makeUser({ monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });
    mockUserAfterUpdate = makeUser({ monthlyTokens: 300, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });

    await grantMonthlyCredits('user-uuid-1', 'hobbyist');

    expect(mockInsert).toHaveBeenCalledOnce();
    const insertValues = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(insertValues.transactionType).toBe('monthly_grant');
    expect(insertValues.amount).toBe(300);
    expect(insertValues.source).toBe('hobbyist');
    expect(insertValues.userId).toBe('user-uuid-1');
  });
});

// ---------------------------------------------------------------------------
// processRollover
// ---------------------------------------------------------------------------

describe('processRollover', () => {
  it('does nothing when user does not exist', async () => {
    mockUser = null;

    await processRollover('ghost', 'creator');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('does nothing when monthly remaining is zero', async () => {
    mockUser = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 1000, addonTokens: 0, earnedCredits: 0 });

    await processRollover('user-uuid-1', 'creator');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does nothing when monthly tokens were never allocated', async () => {
    mockUser = makeUser({ monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });

    await processRollover('user-uuid-1', 'creator');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rolls over unused tokens up to the tier cap', async () => {
    // Creator has 1000 monthly; 400 remaining — rollover capped at 1000, so 400 rolls over
    mockUser = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 600, addonTokens: 0, earnedCredits: 0 });
    mockUserAfterUpdate = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 600, addonTokens: 400, earnedCredits: 0 });

    await processRollover('user-uuid-1', 'creator');
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockInsert).toHaveBeenCalledOnce();
  });

  it('caps rollover at the tier monthly allocation when remaining exceeds cap', async () => {
    // Pro tier cap is 3000, but user somehow has 5000 remaining — capped at 3000
    // This tests the Math.min(monthlyRemaining, cap) branch
    mockUser = makeUser({ monthlyTokens: 5000, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });
    mockUserAfterUpdate = makeUser({ monthlyTokens: 5000, monthlyTokensUsed: 0, addonTokens: 3000, earnedCredits: 0 });

    await processRollover('user-uuid-1', 'pro');
    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it('writes a rollover audit transaction with correct amount', async () => {
    const monthlyRemaining = 200;
    mockUser = makeUser({ monthlyTokens: 300, monthlyTokensUsed: 100, addonTokens: 50, earnedCredits: 0 });
    mockUserAfterUpdate = makeUser({ monthlyTokens: 300, monthlyTokensUsed: 100, addonTokens: 250, earnedCredits: 0 });

    await processRollover('user-uuid-1', 'hobbyist');

    expect(mockInsert).toHaveBeenCalledOnce();
    const insertValues = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(insertValues.transactionType).toBe('rollover');
    expect(insertValues.amount).toBe(monthlyRemaining);
    expect(insertValues.source).toBe('hobbyist');
    expect(insertValues.userId).toBe('user-uuid-1');
  });
});
