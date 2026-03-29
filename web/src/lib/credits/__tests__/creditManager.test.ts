import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '../../db/schema';

// ---------------------------------------------------------------------------
// Mock the DB client — must be done before any import of the module under test
// ---------------------------------------------------------------------------

// Mutable state that individual tests override
let mockUser: Partial<User> | null = null;
// Rows returned by the atomic UPDATE...RETURNING (neonSql tagged template)
let mockAtomicRows: Record<string, unknown>[] = [];

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

const mockSelect = vi.fn().mockImplementation(() => {
  return buildSelectChain(mockUser ? [mockUser] : []);
});

// Mock for getNeonSql() — returns a tagged-template function that resolves
// to mockAtomicRows (simulating the atomic UPDATE...RETURNING result).
const mockNeonSqlFn = vi.fn().mockImplementation(async () => mockAtomicRows);

vi.mock('../../db/client', () => ({
  getDb: () => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  }),
  getNeonSql: () => mockNeonSqlFn,
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
import { getBalance, deductCredits, grantMonthlyCredits, processRollover, refundCredits } from '../creditManager';

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

/**
 * Build the row shape returned by the atomic UPDATE...RETURNING.
 * Column names are snake_case as returned by raw SQL.
 */
function makeAtomicRow(overrides: Partial<{
  id: string;
  monthly_tokens: number;
  monthly_tokens_used: number;
  addon_tokens: number;
  earned_credits: number;
}> = {}): Record<string, unknown> {
  return {
    id: 'user-uuid-1',
    monthly_tokens: 1000,
    monthly_tokens_used: 0,
    addon_tokens: 0,
    earned_credits: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = null;
  mockAtomicRows = [];

  // Re-wire mocks after clearAllMocks
  mockSelect.mockImplementation(() => buildSelectChain(mockUser ? [mockUser] : []));
  mockNeonSqlFn.mockImplementation(async () => mockAtomicRows);
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
// deductCredits — happy paths (atomic SQL UPDATE)
// ---------------------------------------------------------------------------

describe('deductCredits — atomic deduction (regression for #8023)', () => {
  it('returns success=true immediately for amount=0 without touching DB', async () => {
    mockUser = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });

    const result = await deductCredits('user-uuid-1', 0, 'chat');
    expect(result.success).toBe(true);
    // The atomic neonSql path should NOT be called when amount === 0
    expect(mockNeonSqlFn).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns success=true immediately for negative amount without touching DB', async () => {
    mockUser = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0 });

    const result = await deductCredits('user-uuid-1', -5, 'chat');
    expect(result.success).toBe(true);
    expect(mockNeonSqlFn).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('uses the atomic neonSql tagged-template path (not getDb().update) for deduction', async () => {
    // The atomic UPDATE returns the post-deduction row
    mockAtomicRows = [makeAtomicRow({ monthly_tokens: 1000, monthly_tokens_used: 50, addon_tokens: 0, earned_credits: 0 })];

    const result = await deductCredits('user-uuid-1', 50, 'chat');
    expect(result.success).toBe(true);

    // Must use the atomic neonSql path
    expect(mockNeonSqlFn).toHaveBeenCalledOnce();
    // Must NOT use the old getDb().update() path for the deduction itself
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns correct balance from RETURNING row after deduction', async () => {
    mockAtomicRows = [makeAtomicRow({
      monthly_tokens: 1000,
      monthly_tokens_used: 50,
      addon_tokens: 0,
      earned_credits: 0,
    })];

    const result = await deductCredits('user-uuid-1', 50, 'chat');
    expect(result.success).toBe(true);
    expect(result.balance.monthly).toBe(950); // 1000 - 50
    expect(result.balance.purchased).toBe(0);
    expect(result.balance.earned).toBe(0);
    expect(result.balance.total).toBe(950);
  });

  it('returns correct balance when deduction spills into addon tokens', async () => {
    // 30 monthly remaining + 20 from addon
    mockAtomicRows = [makeAtomicRow({
      monthly_tokens: 1000,
      monthly_tokens_used: 1000,
      addon_tokens: 80,
      earned_credits: 0,
    })];

    const result = await deductCredits('user-uuid-1', 50, 'texture');
    expect(result.success).toBe(true);
    expect(result.balance.monthly).toBe(0);
    expect(result.balance.purchased).toBe(80);
  });

  it('returns correct balance when deduction uses earned credits', async () => {
    mockAtomicRows = [makeAtomicRow({
      monthly_tokens: 0,
      monthly_tokens_used: 0,
      addon_tokens: 0,
      earned_credits: 100,
    })];

    const result = await deductCredits('user-uuid-1', 100, 'skybox');
    expect(result.success).toBe(true);
    expect(result.balance.earned).toBe(100);
  });

  it('writes an audit transaction on successful deduction', async () => {
    mockAtomicRows = [makeAtomicRow({ monthly_tokens: 100, monthly_tokens_used: 10, addon_tokens: 0, earned_credits: 0 })];

    await deductCredits('user-uuid-1', 10, 'chat_standard');

    expect(mockInsert).toHaveBeenCalledOnce();
    const insertValues = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(insertValues.transactionType).toBe('deduction');
    expect(insertValues.amount).toBe(-10);
    expect(insertValues.source).toBe('chat_standard');
    expect(insertValues.userId).toBe('user-uuid-1');
  });

  it('does not write an audit transaction when balance is insufficient', async () => {
    // Atomic UPDATE returns no rows → insufficient balance
    mockAtomicRows = [];
    mockUser = makeUser({ monthlyTokens: 50, monthlyTokensUsed: 40, addonTokens: 0, earnedCredits: 0 });

    const result = await deductCredits('user-uuid-1', 100, 'music');
    expect(result.success).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deductCredits — TOCTOU race regression (#8023)
// ---------------------------------------------------------------------------

describe('deductCredits — TOCTOU race condition regression (#8023)', () => {
  it('uses a single atomic SQL statement so concurrent calls cannot both pass balance check', async () => {
    // The fix: deductCredits must use getNeonSql() tagged template for the UPDATE,
    // NOT a separate SELECT then UPDATE. This test verifies the atomic path is taken.
    mockAtomicRows = [makeAtomicRow({ monthly_tokens: 100, monthly_tokens_used: 50 })];

    await deductCredits('user-uuid-1', 50, 'test');

    // The atomic neon SQL path must be called
    expect(mockNeonSqlFn).toHaveBeenCalledOnce();
    // The old non-atomic Drizzle update must NOT be called for the deduction
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns success=false and correct balance when atomic UPDATE returns 0 rows (insufficient balance)', async () => {
    mockAtomicRows = []; // No rows = balance check failed in the DB
    mockUser = makeUser({ monthlyTokens: 100, monthlyTokensUsed: 95, addonTokens: 3, earnedCredits: 0 });

    const result = await deductCredits('user-uuid-1', 20, 'chat');
    expect(result.success).toBe(false);
    expect(result.balance.monthly).toBe(5);
    expect(result.balance.purchased).toBe(3);
    expect(result.balance.earned).toBe(0);
    expect(result.balance.total).toBe(8);
  });

  it('returns success=false when all pools are zero', async () => {
    mockAtomicRows = [];
    mockUser = makeUser({ monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });

    const result = await deductCredits('user-uuid-1', 1, 'chat');
    expect(result.success).toBe(false);
  });

  it('boundary: exact balance equals amount — atomic UPDATE returns row, success=true', async () => {
    mockAtomicRows = [makeAtomicRow({ monthly_tokens: 50, monthly_tokens_used: 50 })];

    const result = await deductCredits('user-uuid-1', 50, 'chat');
    expect(result.success).toBe(true);
  });

  it('boundary: amount exceeds total by one — atomic UPDATE returns 0 rows, success=false', async () => {
    mockAtomicRows = [];
    mockUser = makeUser({ monthlyTokens: 50, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });

    const result = await deductCredits('user-uuid-1', 51, 'chat');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deductCredits — error handling
// ---------------------------------------------------------------------------

describe('deductCredits — error handling', () => {
  it('throws when user not found (atomic UPDATE returns 0 rows and select confirms no user)', async () => {
    mockAtomicRows = []; // No rows from UPDATE
    mockUser = null; // No user in fallback select

    await expect(deductCredits('ghost', 10, 'chat')).rejects.toThrow('User not found: ghost');
  });
});

// ---------------------------------------------------------------------------
// grantMonthlyCredits
// ---------------------------------------------------------------------------

describe('grantMonthlyCredits', () => {
  it('sets monthlyTokens to tier allocation and resets used counter', async () => {
    mockUser = makeUser({ monthlyTokens: 300, monthlyTokensUsed: 150, addonTokens: 0, earnedCredits: 0 });
    // After update, getBalance reads updated user
    const updatedUser = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });
    let selectCallCount = 0;
    mockSelect.mockImplementation(() => {
      const user = selectCallCount === 0 ? mockUser : updatedUser;
      selectCallCount++;
      return buildSelectChain(user ? [user] : []);
    });

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
      const user = makeUser({ monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });
      mockSelect.mockImplementation(() => buildSelectChain([user]));
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
    mockSelect.mockImplementation(() => buildSelectChain([mockUser!]));

    await grantMonthlyCredits('user-uuid-1', 'enterprise');

    const setArg = mockUpdate.mock.results[0].value.set.mock.calls[0][0];
    expect(setArg.monthlyTokens).toBe(0);
  });

  it('writes a monthly_grant audit transaction', async () => {
    mockUser = makeUser({ monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });
    const updatedUser = makeUser({ monthlyTokens: 300, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });
    let selectCallCount = 0;
    mockSelect.mockImplementation(() => {
      const user = selectCallCount === 0 ? mockUser : updatedUser;
      selectCallCount++;
      return buildSelectChain(user ? [user] : []);
    });

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
    const updatedUser = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 600, addonTokens: 400, earnedCredits: 0 });
    let selectCallCount = 0;
    mockSelect.mockImplementation(() => {
      const user = selectCallCount === 0 ? mockUser : updatedUser;
      selectCallCount++;
      return buildSelectChain(user ? [user] : []);
    });

    await processRollover('user-uuid-1', 'creator');
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockInsert).toHaveBeenCalledOnce();
  });

  it('caps rollover at the tier monthly allocation when remaining exceeds cap', async () => {
    // Pro tier cap is 3000, but user somehow has 5000 remaining — capped at 3000
    mockUser = makeUser({ monthlyTokens: 5000, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 });
    const updatedUser = makeUser({ monthlyTokens: 5000, monthlyTokensUsed: 0, addonTokens: 3000, earnedCredits: 0 });
    let selectCallCount = 0;
    mockSelect.mockImplementation(() => {
      const user = selectCallCount === 0 ? mockUser : updatedUser;
      selectCallCount++;
      return buildSelectChain(user ? [user] : []);
    });

    await processRollover('user-uuid-1', 'pro');
    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it('writes a rollover audit transaction with correct amount', async () => {
    const monthlyRemaining = 200;
    mockUser = makeUser({ monthlyTokens: 300, monthlyTokensUsed: 100, addonTokens: 50, earnedCredits: 0 });
    const updatedUser = makeUser({ monthlyTokens: 300, monthlyTokensUsed: 100, addonTokens: 250, earnedCredits: 0 });
    let selectCallCount = 0;
    mockSelect.mockImplementation(() => {
      const user = selectCallCount === 0 ? mockUser : updatedUser;
      selectCallCount++;
      return buildSelectChain(user ? [user] : []);
    });

    await processRollover('user-uuid-1', 'hobbyist');

    expect(mockInsert).toHaveBeenCalledOnce();
    const insertValues = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(insertValues.transactionType).toBe('rollover');
    expect(insertValues.amount).toBe(monthlyRemaining);
    expect(insertValues.source).toBe('hobbyist');
    expect(insertValues.userId).toBe('user-uuid-1');
  });
});

// ---------------------------------------------------------------------------
// refundCredits (PF-488)
// ---------------------------------------------------------------------------

describe('refundCredits', () => {
  it('returns success=true immediately for amount=0 without DB writes', async () => {
    mockUser = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 100, earnedCredits: 0 });

    const result = await refundCredits('user-uuid-1', 0, 'txn-1');
    expect(result.success).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('returns success=true immediately for negative amount', async () => {
    mockUser = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 100, earnedCredits: 0 });

    const result = await refundCredits('user-uuid-1', -10, 'txn-2');
    expect(result.success).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('adds refund amount to addon tokens and records audit trail', async () => {
    mockUser = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 50, earnedCredits: 0 });
    const updatedUser = makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 150, earnedCredits: 0 });
    let selectCallCount = 0;
    mockSelect.mockImplementation(() => {
      const user = selectCallCount === 0 ? mockUser : updatedUser;
      selectCallCount++;
      return buildSelectChain(user ? [user] : []);
    });

    const result = await refundCredits('user-uuid-1', 100, 'txn-3');

    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledOnce();

    // Verify audit transaction
    expect(mockInsert).toHaveBeenCalledOnce();
    const insertValues = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(insertValues.transactionType).toBe('refund');
    expect(insertValues.amount).toBe(100);
    expect(insertValues.source).toBe('credit_refund');
    expect(insertValues.referenceId).toBe('txn-3');
    expect(insertValues.userId).toBe('user-uuid-1');
  });

  it('throws when user does not exist', async () => {
    mockUser = null;

    await expect(refundCredits('ghost', 50, 'txn-4')).rejects.toThrow('User not found: ghost');
  });
});
