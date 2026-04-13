import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- Mocks ----------

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockOrderBy = vi.fn();

/** Standard chainable where result (for select chains with .limit/.returning/.orderBy) */
function chainableWhere() {
  return { limit: mockLimit, returning: mockReturning, orderBy: mockOrderBy };
}

function resetChain() {
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue(chainableWhere());
  mockLimit.mockResolvedValue([]);
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ returning: mockReturning });
  mockReturning.mockResolvedValue([]);
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockWhere });
  mockOrderBy.mockResolvedValue([]);
  mockNeonSqlResults.length = 0;
}

/** Mock neonSql tagged template — returns queued values from mockNeonSqlResults */
const mockNeonSqlResults: unknown[][] = [];
const mockNeonSql = Object.assign(
  vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]): Promise<unknown[]> => {
    const next = mockNeonSqlResults.shift();
    return Promise.resolve(next ?? []);
  }),
  { transaction: vi.fn().mockResolvedValue(undefined) }
);

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  })),
  getNeonSql: vi.fn(() => mockNeonSql),
  queryWithResilience: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/db/schema', () => ({
  users: {
    id: 'id',
    monthlyTokens: 'monthly_tokens',
    monthlyTokensUsed: 'monthly_tokens_used',
    addonTokens: 'addon_tokens',
    billingCycleStart: 'billing_cycle_start',
    updatedAt: 'updated_at',
    tier: 'tier',
  },
  tokenUsage: {
    id: 'id',
    userId: 'user_id',
    operation: 'operation',
    tokens: 'tokens',
    source: 'source',
    provider: 'provider',
    metadata: 'metadata',
    createdAt: 'created_at',
  },
  tokenPurchases: {
    userId: 'user_id',
    stripePaymentIntent: 'stripe_payment_intent',
    package: 'package',
    tokens: 'tokens',
    amountCents: 'amount_cents',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_a: unknown, _b: unknown) => 'eq-condition'),
  sql: vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => 'sql-expression'),
  and: vi.fn((..._args: unknown[]) => 'and-condition'),
  gte: vi.fn((_a: unknown, _b: unknown) => 'gte-condition'),
}));

// ---------- Tests ----------

describe('getTokenBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('returns correct balance for a user with monthly and addon tokens', async () => {
    const { getTokenBalance } = await import('../service');

    mockLimit.mockResolvedValueOnce([{
      monthlyTokens: 100,
      monthlyTokensUsed: 30,
      addonTokens: 200,
      billingCycleStart: new Date('2026-01-15'),
    }]);

    const balance = await getTokenBalance('user-1');

    expect(balance.monthlyRemaining).toBe(70);
    expect(balance.monthlyTotal).toBe(100);
    expect(balance.addon).toBe(200);
    expect(balance.total).toBe(270);
    expect(balance.nextRefillDate).toContain('2026-02-14');
  });

  it('clamps monthlyRemaining to 0 when overused', async () => {
    const { getTokenBalance } = await import('../service');

    mockLimit.mockResolvedValueOnce([{
      monthlyTokens: 50,
      monthlyTokensUsed: 80,
      addonTokens: 10,
      billingCycleStart: new Date('2026-01-01'),
    }]);

    const balance = await getTokenBalance('user-1');

    expect(balance.monthlyRemaining).toBe(0);
    expect(balance.total).toBe(10);
  });

  it('returns null nextRefillDate when billingCycleStart is null', async () => {
    const { getTokenBalance } = await import('../service');

    mockLimit.mockResolvedValueOnce([{
      monthlyTokens: 50,
      monthlyTokensUsed: 0,
      addonTokens: 0,
      billingCycleStart: null,
    }]);

    const balance = await getTokenBalance('user-1');

    expect(balance.nextRefillDate).toBeNull();
  });

  it('throws for user not found', async () => {
    const { getTokenBalance } = await import('../service');

    mockLimit.mockResolvedValueOnce([]);

    await expect(getTokenBalance('nonexistent')).rejects.toThrow('User not found: nonexistent');
  });

  it('returns zero total when no tokens available', async () => {
    const { getTokenBalance } = await import('../service');

    mockLimit.mockResolvedValueOnce([{
      monthlyTokens: 0,
      monthlyTokensUsed: 0,
      addonTokens: 0,
      billingCycleStart: null,
    }]);

    const balance = await getTokenBalance('user-1');

    expect(balance.monthlyRemaining).toBe(0);
    expect(balance.addon).toBe(0);
    expect(balance.total).toBe(0);
  });
});

describe('deductTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resetChain();
  });

  it('returns success with usageId "free" for zero-cost operations', async () => {
    const { deductTokens } = await import('../service');

    // getTokenBalance call inside deductTokens
    mockLimit.mockResolvedValueOnce([{
      monthlyTokens: 50,
      monthlyTokensUsed: 0,
      addonTokens: 0,
      billingCycleStart: null,
    }]);

    const result = await deductTokens('user-1', 'scene_edit', 0);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.usageId).toBe('free');
    }
  });

  it('returns INSUFFICIENT_TOKENS when balance is too low', async () => {
    const { deductTokens } = await import('../service');

    // First call: deductTokens reads user
    mockLimit.mockResolvedValueOnce([{
      monthlyTokens: 10,
      monthlyTokensUsed: 5,
      addonTokens: 0,
      billingCycleStart: null,
    }]);

    const result = await deductTokens('user-1', 'texture_generation', 30);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('INSUFFICIENT_TOKENS');
      expect(result.cost).toBe(30);
      expect(result.balance.total).toBe(5);
    }
  });

  it('deducts from monthly tokens when sufficient', async () => {
    const { deductTokens } = await import('../service');

    // Read user (via Drizzle)
    mockLimit.mockResolvedValueOnce([{
      monthlyTokens: 100,
      monthlyTokensUsed: 10,
      addonTokens: 50,
      billingCycleStart: null,
    }]);

    // neonSql UPDATE RETURNING (atomic deduction)
    mockNeonSqlResults.push([{ id: 'user-1' }]);
    // neonSql INSERT RETURNING (usage log)
    mockNeonSqlResults.push([{ id: 'usage-123' }]);

    // getTokenBalance call after deduction
    mockLimit.mockResolvedValueOnce([{
      monthlyTokens: 100,
      monthlyTokensUsed: 40,
      addonTokens: 50,
      billingCycleStart: null,
    }]);

    const result = await deductTokens('user-1', 'texture_generation', 30);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.usageId).toBe('usage-123');
    }
  });

  it('deducts from addon tokens when monthly depleted', async () => {
    const { deductTokens } = await import('../service');

    // Read user: monthly fully used
    mockLimit.mockResolvedValueOnce([{
      monthlyTokens: 50,
      monthlyTokensUsed: 50,
      addonTokens: 100,
      billingCycleStart: null,
    }]);

    // neonSql UPDATE RETURNING (atomic deduction)
    mockNeonSqlResults.push([{ id: 'user-1' }]);
    // neonSql INSERT RETURNING (usage log)
    mockNeonSqlResults.push([{ id: 'usage-456' }]);

    // getTokenBalance after
    mockLimit.mockResolvedValueOnce([{
      monthlyTokens: 50,
      monthlyTokensUsed: 50,
      addonTokens: 70,
      billingCycleStart: null,
    }]);

    const result = await deductTokens('user-1', 'texture_generation', 30);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.usageId).toBe('usage-456');
    }
  });

  it('uses mixed source when partial monthly tokens remain', async () => {
    const { deductTokens } = await import('../service');

    // Read user: 10 monthly remaining, need 30
    mockLimit.mockResolvedValueOnce([{
      monthlyTokens: 50,
      monthlyTokensUsed: 40,
      addonTokens: 100,
      billingCycleStart: null,
    }]);

    // neonSql UPDATE RETURNING (atomic deduction)
    mockNeonSqlResults.push([{ id: 'user-1' }]);
    // neonSql INSERT RETURNING (usage log)
    mockNeonSqlResults.push([{ id: 'usage-789' }]);

    // getTokenBalance after
    mockLimit.mockResolvedValueOnce([{
      monthlyTokens: 50,
      monthlyTokensUsed: 50,
      addonTokens: 80,
      billingCycleStart: null,
    }]);

    const result = await deductTokens('user-1', 'texture_generation', 30);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.usageId).toBe('usage-789');
    }
  });

  it('throws for user not found', async () => {
    const { deductTokens } = await import('../service');

    mockLimit.mockResolvedValueOnce([]);

    await expect(deductTokens('ghost', 'op', 10)).rejects.toThrow('User not found: ghost');
  });

  it('retries on race condition (empty update result) and fails after 3 retries', async () => {
    const { deductTokens } = await import('../service');

    // Each retry reads the user (4 total: initial + 3 retries)
    for (let i = 0; i < 4; i++) {
      mockLimit.mockResolvedValueOnce([{
        monthlyTokens: 100,
        monthlyTokensUsed: 0,
        addonTokens: 0,
        billingCycleStart: null,
      }]);
      // neonSql UPDATE returns empty (race condition)
      mockNeonSqlResults.push([]);
    }

    // Final getTokenBalance after exhausting retries
    mockLimit.mockResolvedValueOnce([{
      monthlyTokens: 100,
      monthlyTokensUsed: 0,
      addonTokens: 0,
      billingCycleStart: null,
    }]);

    const result = await deductTokens('user-1', 'op', 10);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('INSUFFICIENT_TOKENS');
    }
  });

  it('handles negative tokenCost as free operation', async () => {
    const { deductTokens } = await import('../service');

    mockLimit.mockResolvedValueOnce([{
      monthlyTokens: 50,
      monthlyTokensUsed: 0,
      addonTokens: 0,
      billingCycleStart: null,
    }]);

    const result = await deductTokens('user-1', 'refund', -5);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.usageId).toBe('free');
    }
  });
});

describe('refundTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resetChain();
  });

  it('returns refunded:false and skips DB for free usageId', async () => {
    const { refundTokens } = await import('../service');

    const result = await refundTokens('user-1', 'free');

    expect(result.refunded).toBe(false);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('returns refunded:false when usage record not found', async () => {
    const { refundTokens } = await import('../service');

    mockLimit.mockResolvedValueOnce([]);

    const result = await refundTokens('user-1', 'missing-id');

    expect(result.refunded).toBe(false);
    expect(mockSelect).toHaveBeenCalled();
    expect(mockNeonSql).not.toHaveBeenCalled();
  });

  it('refunds monthly tokens via CTE statement', async () => {
    const { refundTokens } = await import('../service');

    mockWhere.mockReturnValueOnce(chainableWhere());
    mockLimit.mockResolvedValueOnce([{
      id: 'usage-1', userId: 'user-1', tokens: 30, source: 'monthly', provider: 'anthropic',
    }]);
    // 2 neonSql calls: setClause fragment (consumed, ignored) + CTE query
    mockNeonSqlResults.push([]); // setClause fragment
    mockNeonSqlResults.push([{ id: 'user-1' }]); // CTE RETURNING → refund succeeded

    const result = await refundTokens('user-1', 'usage-1');

    expect(result.refunded).toBe(true);
    expect(mockNeonSql).toHaveBeenCalledTimes(2);
  });

  it('returns refunded:false when idempotency guard skips duplicate', async () => {
    const { refundTokens } = await import('../service');

    mockWhere.mockReturnValueOnce(chainableWhere());
    mockLimit.mockResolvedValueOnce([{
      id: 'usage-dup', userId: 'user-1', tokens: 20, source: 'addon', provider: 'anthropic',
    }]);
    // CTE query returns empty (INSERT was no-op, UPDATE skipped) → already refunded
    // mockNeonSqlResults defaults to [] so no push needed

    const result = await refundTokens('user-1', 'usage-dup');

    expect(result.refunded).toBe(false);
    expect(mockNeonSql).toHaveBeenCalledTimes(2);
  });

  it('refunds addon tokens via CTE statement', async () => {
    const { refundTokens } = await import('../service');

    mockWhere.mockReturnValueOnce(chainableWhere());
    mockLimit.mockResolvedValueOnce([{
      id: 'usage-2', userId: 'user-1', tokens: 50, source: 'addon', provider: null,
    }]);
    mockNeonSqlResults.push([]); // setClause fragment
    mockNeonSqlResults.push([{ id: 'user-1' }]); // CTE RETURNING

    const result = await refundTokens('user-1', 'usage-2');

    expect(result.refunded).toBe(true);
    expect(mockNeonSql).toHaveBeenCalledTimes(2);
  });

  it('refunds mixed source proportionally to both pools via CTE', async () => {
    const { refundTokens } = await import('../service');

    mockWhere.mockReturnValueOnce(chainableWhere());
    mockLimit.mockResolvedValueOnce([{
      id: 'usage-3', userId: 'user-1', tokens: 40, source: 'mixed', provider: 'meshy',
      metadata: { _split: { monthly: 15, addon: 25 } },
    }]);
    mockNeonSqlResults.push([]); // setClause fragment (monthly_tokens_used + addon_tokens)
    mockNeonSqlResults.push([{ id: 'user-1' }]); // CTE RETURNING

    const result = await refundTokens('user-1', 'usage-3');

    expect(result.refunded).toBe(true);
    expect(mockNeonSql).toHaveBeenCalledTimes(2);
    // Verify setClause fragment received both proportional amounts
    const setClauseCall = mockNeonSql.mock.calls[0];
    const setClauseValues = setClauseCall.slice(1);
    expect(setClauseValues).toContain(15); // monthlyPortion
    expect(setClauseValues).toContain(25); // addonPortion
  });

  it('falls back to addon for mixed source without _split metadata', async () => {
    const { refundTokens } = await import('../service');

    mockWhere.mockReturnValueOnce(chainableWhere());
    mockLimit.mockResolvedValueOnce([{
      id: 'usage-4', userId: 'user-1', tokens: 40, source: 'mixed', provider: 'meshy',
      metadata: {}, // no _split
    }]);
    mockNeonSqlResults.push([]); // setClause fragment (addon_tokens only)
    mockNeonSqlResults.push([{ id: 'user-1' }]); // CTE RETURNING

    const result = await refundTokens('user-1', 'usage-4');

    expect(result.refunded).toBe(true);
    // Verify setClause uses addon path (monthlyPortion=0, addonPortion=tokens)
    const setClauseCall = mockNeonSql.mock.calls[0];
    const setClauseValues = setClauseCall.slice(1);
    expect(setClauseValues).toContain(0);  // monthlyPortion
    expect(setClauseValues).toContain(40); // addonPortion = full amount
  });

  it('returns refunded:false for free usageId', async () => {
    const { refundTokens } = await import('../service');
    const result = await refundTokens('user-1', 'free');
    expect(result.refunded).toBe(false);
  });

  it('returns refunded:false when usage record not found', async () => {
    const { refundTokens } = await import('../service');
    mockLimit.mockResolvedValueOnce([]);
    const result = await refundTokens('user-1', 'missing');
    expect(result.refunded).toBe(false);
  });

  it('propagates CTE errors to caller', async () => {
    const { refundTokens } = await import('../service');

    mockWhere.mockReturnValueOnce(chainableWhere());
    mockLimit.mockResolvedValueOnce([{
      id: 'usage-err', userId: 'user-1', tokens: 10, source: 'addon', provider: 'anthropic',
    }]);

    // First call builds the setClause fragment, second is the CTE execution
    mockNeonSql
      .mockResolvedValueOnce([]) // setClause fragment
      .mockRejectedValueOnce(new Error('connection reset')); // CTE execution

    await expect(refundTokens('user-1', 'usage-err')).rejects.toThrow('connection reset');
  });
});

describe('refundTokenAmount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resetChain();
  });

  it('skips refund when tokens <= 0', async () => {
    const { refundTokenAmount } = await import('../service');

    await refundTokenAmount('user-1', 0, 'no-op');

    expect(mockNeonSql).not.toHaveBeenCalled();
    expect(mockNeonSql.transaction).not.toHaveBeenCalled();
  });

  it('uses CTE for idempotent refund when usageId is provided', async () => {
    const { refundTokenAmount } = await import('../service');

    // Mock the source lookup (now returns source + tokens + metadata)
    mockWhere.mockReturnValueOnce(chainableWhere());
    mockLimit.mockResolvedValueOnce([{ source: 'addon', tokens: 50, metadata: null }]);

    await refundTokenAmount('user-1', 50, 'partial failure', 'usage-123');

    // 2 neonSql calls: setClause fragment + CTE query (not transaction)
    expect(mockNeonSql).toHaveBeenCalledTimes(2);
    expect(mockNeonSql.transaction).not.toHaveBeenCalled();
  });

  it('uses transaction for non-idempotent refund without usageId', async () => {
    const { refundTokenAmount } = await import('../service');

    mockNeonSql.transaction.mockResolvedValue(undefined);

    await refundTokenAmount('user-1', 25, 'error recovery');

    // 3 neonSql calls: setClause fragment + 2 transaction statements
    expect(mockNeonSql.transaction).toHaveBeenCalledTimes(1);
    expect(mockNeonSql.transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it('looks up original source from usage record', async () => {
    const { refundTokenAmount } = await import('../service');

    // Mock: usage record has monthly source
    mockWhere.mockReturnValueOnce(chainableWhere());
    mockLimit.mockResolvedValueOnce([{ source: 'monthly', tokens: 30, metadata: null }]);

    await refundTokenAmount('user-1', 30, 'batch fail', 'usage-monthly');

    expect(mockSelect).toHaveBeenCalled();
    // 2 neonSql calls: setClause fragment + CTE query
    expect(mockNeonSql).toHaveBeenCalledTimes(2);
  });

  it('defaults to addon source when usage record not found', async () => {
    const { refundTokenAmount } = await import('../service');

    // Mock: no usage record found
    mockWhere.mockReturnValueOnce(chainableWhere());
    mockLimit.mockResolvedValueOnce([]);

    await refundTokenAmount('user-1', 20, 'fallback', 'usage-gone');

    // 2 neonSql calls: setClause fragment + CTE query (defaults to addon pool)
    expect(mockNeonSql).toHaveBeenCalledTimes(2);
  });

  it('proportionally refunds both pools for mixed source with _split', async () => {
    const { refundTokenAmount } = await import('../service');

    // Original deduction: 100 tokens total, 60 monthly + 40 addon
    mockWhere.mockReturnValueOnce(chainableWhere());
    mockLimit.mockResolvedValueOnce([{
      source: 'mixed',
      tokens: 100,
      metadata: { _split: { monthly: 60, addon: 40 } },
    }]);

    // Refund 50 tokens → monthly: round(60*50/100) = 30, addon: 50-30 = 20
    await refundTokenAmount('user-1', 50, 'pipeline_unused_budget', 'usage-mixed');

    expect(mockNeonSql).toHaveBeenCalledTimes(2);
    // Verify setClause fragment contains proportional amounts
    const setClauseCall = mockNeonSql.mock.calls[0];
    const setClauseValues = setClauseCall.slice(1);
    expect(setClauseValues).toContain(30); // monthlyRefund
    expect(setClauseValues).toContain(20); // addonRefund
  });

  it('falls back to addon for mixed source without _split metadata', async () => {
    const { refundTokenAmount } = await import('../service');

    // Old record without _split metadata
    mockWhere.mockReturnValueOnce(chainableWhere());
    mockLimit.mockResolvedValueOnce([{
      source: 'mixed',
      tokens: 80,
      metadata: { type: 'pipeline_reservation' },
    }]);

    await refundTokenAmount('user-1', 40, 'pipeline_unused_budget', 'usage-old');

    // Falls through to addon path (backward compat)
    expect(mockNeonSql).toHaveBeenCalledTimes(2);
    const setClauseCall = mockNeonSql.mock.calls[0];
    const setClauseValues = setClauseCall.slice(1);
    expect(setClauseValues).toContain(40); // full amount to addon
  });
});

describe('creditAddonTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resetChain();
    mockNeonSql.transaction.mockResolvedValue(undefined);
  });

  it('credits spark package tokens and logs purchase atomically', async () => {
    const { creditAddonTokens } = await import('../service');

    await creditAddonTokens('user-1', 'spark', 'pi_stripe_123');

    expect(mockNeonSql.transaction).toHaveBeenCalledTimes(1);
    const statements = mockNeonSql.transaction.mock.calls[0][0];
    expect(statements).toHaveLength(2);
  });

  it('credits blaze package tokens atomically', async () => {
    const { creditAddonTokens } = await import('../service');

    await creditAddonTokens('user-1', 'blaze', 'pi_stripe_456');

    expect(mockNeonSql.transaction).toHaveBeenCalledTimes(1);
  });

  it('credits inferno package tokens atomically', async () => {
    const { creditAddonTokens } = await import('../service');

    await creditAddonTokens('user-1', 'inferno', 'pi_stripe_789');

    expect(mockNeonSql.transaction).toHaveBeenCalledTimes(1);
  });
});

describe('resetMonthlyTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resetChain();
  });

  it('resets to starter allocation', async () => {
    const { resetMonthlyTokens } = await import('../service');

    mockWhere.mockResolvedValueOnce([]);

    await resetMonthlyTokens('user-1', 'starter');

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalled();
  });

  it('resets to pro allocation', async () => {
    const { resetMonthlyTokens } = await import('../service');

    mockWhere.mockResolvedValueOnce([]);

    await resetMonthlyTokens('user-1', 'pro');

    expect(mockUpdate).toHaveBeenCalled();
  });

  it('resets to hobbyist allocation', async () => {
    const { resetMonthlyTokens } = await import('../service');

    mockWhere.mockResolvedValueOnce([]);

    await resetMonthlyTokens('user-1', 'hobbyist');

    expect(mockUpdate).toHaveBeenCalled();
  });

  it('resets to creator allocation', async () => {
    const { resetMonthlyTokens } = await import('../service');

    mockWhere.mockResolvedValueOnce([]);

    await resetMonthlyTokens('user-1', 'creator');

    expect(mockUpdate).toHaveBeenCalled();
  });
});

describe('getUsageHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resetChain();
  });

  it('returns usage records ordered by date', async () => {
    const { getUsageHistory } = await import('../service');

    const mockRecords = [
      { operation: 'texture_generation', tokens: 30, provider: 'meshy', createdAt: new Date('2026-02-01') },
      { operation: 'chat_short', tokens: 5, provider: 'anthropic', createdAt: new Date('2026-02-15') },
    ];
    mockOrderBy.mockResolvedValueOnce(mockRecords);

    const result = await getUsageHistory('user-1');

    expect(result).toHaveLength(2);
    expect(result[0].operation).toBe('texture_generation');
    expect(result[1].tokens).toBe(5);
  });

  it('returns empty array when no usage', async () => {
    const { getUsageHistory } = await import('../service');

    mockOrderBy.mockResolvedValueOnce([]);

    const result = await getUsageHistory('user-1');

    expect(result).toEqual([]);
  });

  it('accepts custom days parameter', async () => {
    const { getUsageHistory } = await import('../service');

    mockOrderBy.mockResolvedValueOnce([]);

    const result = await getUsageHistory('user-1', 7);

    expect(result).toEqual([]);
    expect(mockSelect).toHaveBeenCalled();
  });

  it('defaults to 30 days', async () => {
    const { getUsageHistory } = await import('../service');

    mockOrderBy.mockResolvedValueOnce([]);

    await getUsageHistory('user-1');

    expect(mockSelect).toHaveBeenCalled();
  });
});
