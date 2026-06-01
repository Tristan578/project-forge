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

  // #8662: WHERE NOT EXISTS is a READ COMMITTED snapshot check, not a lock — two
  // concurrent refunds for the same usageId can each miss the other's uncommitted
  // INSERT and both credit. The fix mirrors creditAddonTokens: a UNIQUE partial
  // index + ON CONFLICT DO NOTHING so the DB serialises the second insert to a
  // no-op. The service-level guarantee is that it emits the conflict-based
  // mechanism (the index, added in drizzle/0004, enforces the actual exactly-once).
  it('uses ON CONFLICT DO NOTHING (not a snapshot NOT EXISTS) for idempotency', async () => {
    const { refundTokens } = await import('../service');

    mockWhere.mockReturnValueOnce(chainableWhere());
    mockLimit.mockResolvedValueOnce([{
      id: 'usage-cc', userId: 'user-1', tokens: 30, source: 'addon', provider: 'anthropic',
    }]);
    mockNeonSqlResults.push([]); // setClause fragment
    mockNeonSqlResults.push([{ id: 'user-1' }]); // CTE RETURNING

    await refundTokens('user-1', 'usage-cc');

    // calls[0] = setClause fragment, calls[1] = main CTE statement
    const sql = (mockNeonSql.mock.calls[1][0] as TemplateStringsArray).join(' ');
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO NOTHING');
    expect(sql).not.toContain('NOT EXISTS');
    // Boundary (architect #8662): this function owns the 'refund' operation namespace,
    // distinct from refundTokenAmount's 'partial_refund'. And userId is cast ::uuid so
    // the ON CONFLICT arbiter resolves against the uuid-typed partial unique index.
    expect(sql).toContain("'refund'");
    expect(sql).toContain('::uuid');
  });

  it('AC1: two refunds for the same usageId credit exactly once (loser hits ON CONFLICT)', async () => {
    const { refundTokens } = await import('../service');
    const record = {
      id: 'usage-once', userId: 'user-1', tokens: 25, source: 'addon', provider: 'anthropic',
    };

    // First refund: INSERT wins → CTE RETURNING a row → credited.
    mockWhere.mockReturnValueOnce(chainableWhere());
    mockLimit.mockResolvedValueOnce([record]);
    mockNeonSqlResults.push([]); // setClause fragment
    mockNeonSqlResults.push([{ id: 'user-1' }]); // CTE inserted + credited
    const first = await refundTokens('user-1', 'usage-once');

    // Second refund: same usageId. The unique index forces ON CONFLICT → INSERT is
    // a no-op → EXISTS(ins) false → UPDATE skipped → CTE RETURNING empty.
    mockWhere.mockReturnValueOnce(chainableWhere());
    mockLimit.mockResolvedValueOnce([record]);
    mockNeonSqlResults.push([]); // setClause fragment
    mockNeonSqlResults.push([]); // CTE conflict → no credit
    const second = await refundTokens('user-1', 'usage-once');

    expect(first.refunded).toBe(true);
    expect(second.refunded).toBe(false);
    expect([first, second].filter((r) => r.refunded)).toHaveLength(1);
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

  // #8662: the partial_refund idempotent path shares the same WHERE NOT EXISTS race
  // as refundTokens. Its INSERT must also use ON CONFLICT DO NOTHING so concurrent
  // partial refunds for one usageId credit at most once (backed by the same
  // drizzle/0004 unique index, which covers operation IN ('refund','partial_refund')).
  it('idempotent path uses ON CONFLICT DO NOTHING (not a snapshot NOT EXISTS)', async () => {
    const { refundTokenAmount } = await import('../service');

    mockWhere.mockReturnValueOnce(chainableWhere());
    mockLimit.mockResolvedValueOnce([{ source: 'addon', tokens: 50, metadata: null }]);
    mockNeonSqlResults.push([]); // setClause fragment
    mockNeonSqlResults.push([]); // CTE statement

    await refundTokenAmount('user-1', 50, 'partial failure', 'usage-partial-cc');

    // calls[0] = setClause fragment, calls[1] = idempotent CTE statement
    const sql = (mockNeonSql.mock.calls[1][0] as TemplateStringsArray).join(' ');
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO NOTHING');
    expect(sql).not.toContain('NOT EXISTS');
  });

  // #8662: token_usage.user_id and users.id are uuid columns, but neon-http binds
  // ${userId} as text. The idempotent CTE INSERT must cast ${userId}::uuid so its
  // value matches the uuid-typed partial unique index — otherwise the ON CONFLICT
  // arbiter inference fails at runtime ("no unique or exclusion constraint matching
  // the ON CONFLICT specification"). This regression test pins the cast that
  // refundTokens already carries; without it the security guard silently breaks in
  // production while mock-based tests stay green.
  it('idempotent path casts userId to uuid so the ON CONFLICT arbiter resolves', async () => {
    const { refundTokenAmount } = await import('../service');

    mockWhere.mockReturnValueOnce(chainableWhere());
    mockLimit.mockResolvedValueOnce([{ source: 'addon', tokens: 50, metadata: null }]);
    mockNeonSqlResults.push([]); // setClause fragment
    mockNeonSqlResults.push([]); // CTE statement

    await refundTokenAmount('user-1', 50, 'partial failure', 'usage-cast');

    const sql = (mockNeonSql.mock.calls[1][0] as TemplateStringsArray).join(' ');
    // Both the INSERT value and the UPDATE predicate bind userId as uuid.
    expect(sql).toContain('::uuid');
    expect(sql).toContain('ON CONFLICT');
  });

  // #8662 boundary (architect finding): refundTokens writes operation='refund' and
  // refundTokenAmount writes operation='partial_refund'. The idempotency key includes
  // operation, so these two share a usageId but live in DIFFERENT key namespaces and
  // each credits once. This is intentional (they restore different amounts/pools);
  // callers must treat them as mutually exclusive per usageId. This test pins the
  // operation literal so a refactor can't silently collapse the two namespaces (which
  // would change refund semantics) without a failing test.
  it('writes a distinct operation namespace (partial_refund) from refundTokens', async () => {
    const { refundTokenAmount } = await import('../service');

    mockWhere.mockReturnValueOnce(chainableWhere());
    mockLimit.mockResolvedValueOnce([{ source: 'addon', tokens: 50, metadata: null }]);
    mockNeonSqlResults.push([]); // setClause fragment
    mockNeonSqlResults.push([]); // CTE statement

    await refundTokenAmount('user-1', 50, 'partial failure', 'usage-boundary');

    const sql = (mockNeonSql.mock.calls[1][0] as TemplateStringsArray).join(' ');
    // partial_refund is this function's operation; the conflict predicate spans both
    // refund operations, but the inserted row is keyed to partial_refund specifically.
    expect(sql).toContain("'partial_refund'");
    expect(sql).toContain("operation IN ('refund','partial_refund')");
  });
});

describe('creditAddonTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resetChain();
    // CTE returns the inserted id by default (new purchase → credit applied).
    mockNeonSqlResults.push([{ id: 'user-1' }]);
  });

  it('credits spark package tokens via a single idempotent CTE (F02)', async () => {
    const { creditAddonTokens } = await import('../service');

    await creditAddonTokens('user-1', 'spark', 'pi_stripe_123');

    // One tagged-template statement — NOT a multi-statement transaction.
    expect(mockNeonSql).toHaveBeenCalledTimes(1);
    expect(mockNeonSql.transaction).not.toHaveBeenCalled();

    const sql = (mockNeonSql.mock.calls[0][0] as TemplateStringsArray).join(' ');
    // Idempotency guard: INSERT ... ON CONFLICT DO NOTHING, UPDATE gated on EXISTS.
    expect(sql).toContain('token_purchases');
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO NOTHING');
    expect(sql).toContain('addon_tokens = addon_tokens +');
    expect(sql).toContain('EXISTS (SELECT 1 FROM ins)');

    // Interpolated values carry the user, payment intent, package, and amounts.
    const values = mockNeonSql.mock.calls[0].slice(1);
    expect(values).toContain('user-1');
    expect(values).toContain('pi_stripe_123');
    expect(values).toContain('spark');
    expect(values).toContain(1000); // spark tokens
    expect(values).toContain(1200); // spark priceCents
  });

  it('credits blaze package tokens via a single statement', async () => {
    const { creditAddonTokens } = await import('../service');

    await creditAddonTokens('user-1', 'blaze', 'pi_stripe_456');

    expect(mockNeonSql).toHaveBeenCalledTimes(1);
    expect(mockNeonSql.transaction).not.toHaveBeenCalled();
    const values = mockNeonSql.mock.calls[0].slice(1);
    expect(values).toContain(5000); // blaze tokens
  });

  it('credits inferno package tokens via a single statement', async () => {
    const { creditAddonTokens } = await import('../service');

    await creditAddonTokens('user-1', 'inferno', 'pi_stripe_789');

    expect(mockNeonSql).toHaveBeenCalledTimes(1);
    expect(mockNeonSql.transaction).not.toHaveBeenCalled();
    const values = mockNeonSql.mock.calls[0].slice(1);
    expect(values).toContain(20000); // inferno tokens
  });

  it('passes the payment intent so a redelivered webhook hits ON CONFLICT (idempotent)', async () => {
    const { creditAddonTokens } = await import('../service');

    // Simulate redelivery: the CTE INSERT conflicts, RETURNING is empty.
    mockNeonSqlResults.length = 0;
    mockNeonSqlResults.push([]); // ON CONFLICT DO NOTHING → no row returned → no credit

    await creditAddonTokens('user-1', 'spark', 'pi_dup_001');

    // Still a single statement; the DB (not JS) enforces exactly-once via the
    // EXISTS(ins) guard, so no second credit path exists to call.
    expect(mockNeonSql).toHaveBeenCalledTimes(1);
    const sql = (mockNeonSql.mock.calls[0][0] as TemplateStringsArray).join(' ');
    expect(sql).toContain('ON CONFLICT');
    const values = mockNeonSql.mock.calls[0].slice(1);
    expect(values).toContain('pi_dup_001');
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
