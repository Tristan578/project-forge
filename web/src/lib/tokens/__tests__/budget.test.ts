import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- Mocks ----------

const mockDeductTokens = vi.fn();
const mockRefundTokenAmount = vi.fn();
const mockGetTokenBalance = vi.fn();

vi.mock('@/lib/tokens/service', () => ({
  deductTokens: (...args: unknown[]) => mockDeductTokens(...args),
  refundTokenAmount: (...args: unknown[]) => mockRefundTokenAmount(...args),
  getTokenBalance: (...args: unknown[]) => mockGetTokenBalance(...args),
}));

const mockNeonSqlResults: unknown[][] = [];
const mockNeonSql = vi.fn(
  (_strings: TemplateStringsArray, ..._values: unknown[]): Promise<unknown[]> => {
    const next = mockNeonSqlResults.shift();
    return Promise.resolve(next ?? []);
  },
);

vi.mock('@/lib/db/client', () => ({
  getNeonSql: vi.fn(() => mockNeonSql),
  queryWithResilience: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

// ---------- Helpers ----------

const MOCK_BALANCE = {
  monthlyRemaining: 500,
  monthlyTotal: 1000,
  addon: 200,
  total: 700,
  nextRefillDate: null,
};

function resetMocks() {
  vi.clearAllMocks();
  mockNeonSqlResults.length = 0;
  mockGetTokenBalance.mockResolvedValue(MOCK_BALANCE);
  mockRefundTokenAmount.mockResolvedValue(undefined);
}

// ---------- Tests ----------

import {
  reserveTokenBudget,
  releaseUnusedBudget,
  recordStepUsage,
} from '../budget';

describe('reserveTokenBudget', () => {
  beforeEach(resetMocks);

  it('deducts tokens via deductTokens with pipeline_reserve operation', async () => {
    mockDeductTokens.mockResolvedValue({
      success: true,
      usageId: 'usage-123',
      remaining: MOCK_BALANCE,
    });

    const result = await reserveTokenBudget('user-1', 100);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.reservationId).toBe('usage-123');
      expect(result.remaining).toEqual(MOCK_BALANCE);
    }

    expect(mockDeductTokens).toHaveBeenCalledWith(
      'user-1',
      'pipeline_reserve',
      100,
      undefined,
      { type: 'pipeline_reservation', estimatedTotal: 100 },
    );
  });

  it('returns error when balance is insufficient', async () => {
    mockDeductTokens.mockResolvedValue({
      success: false,
      error: 'INSUFFICIENT_TOKENS',
      balance: { ...MOCK_BALANCE, total: 50 },
      cost: 100,
    });

    const result = await reserveTokenBudget('user-1', 100);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('INSUFFICIENT_TOKENS');
      expect(result.cost).toBe(100);
    }
  });

  it('returns free reservation for zero cost', async () => {
    const result = await reserveTokenBudget('user-1', 0);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.reservationId).toBe('free');
    }
    expect(mockDeductTokens).not.toHaveBeenCalled();
  });

  it('returns free reservation for negative cost', async () => {
    const result = await reserveTokenBudget('user-1', -10);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.reservationId).toBe('free');
    }
    expect(mockDeductTokens).not.toHaveBeenCalled();
  });
});

describe('releaseUnusedBudget', () => {
  beforeEach(resetMocks);

  it('refunds the difference between reserved and actual', async () => {
    // Mock DB query returning the reservation record
    mockNeonSqlResults.push([{ tokens: 200, metadata: { estimatedTotal: 200 } }]);

    const result = await releaseUnusedBudget('user-1', 'res-123', 120);

    expect(result.refunded).toBe(80);
    expect(mockRefundTokenAmount).toHaveBeenCalledWith(
      'user-1',
      80,
      'pipeline_unused_budget',
      'res-123',
    );
  });

  it('does not refund when actual equals reserved', async () => {
    mockNeonSqlResults.push([{ tokens: 100, metadata: {} }]);

    const result = await releaseUnusedBudget('user-1', 'res-123', 100);

    expect(result.refunded).toBe(0);
    expect(mockRefundTokenAmount).not.toHaveBeenCalled();
  });

  it('does not refund when actual exceeds reserved', async () => {
    mockNeonSqlResults.push([{ tokens: 100, metadata: {} }]);

    const result = await releaseUnusedBudget('user-1', 'res-123', 150);

    expect(result.refunded).toBe(0);
    expect(mockRefundTokenAmount).not.toHaveBeenCalled();
  });

  it('handles missing reservation record gracefully', async () => {
    // No rows returned
    mockNeonSqlResults.push([]);

    const result = await releaseUnusedBudget('user-1', 'nonexistent', 50);

    expect(result.refunded).toBe(0);
    expect(mockRefundTokenAmount).not.toHaveBeenCalled();
  });

  it('is a no-op for free reservations', async () => {
    const result = await releaseUnusedBudget('user-1', 'free', 0);

    expect(result.refunded).toBe(0);
    expect(mockNeonSql).not.toHaveBeenCalled();
  });

  it('returns current balance after release', async () => {
    mockNeonSqlResults.push([{ tokens: 200, metadata: {} }]);
    const updatedBalance = { ...MOCK_BALANCE, total: 780 };
    mockGetTokenBalance.mockResolvedValue(updatedBalance);

    const result = await releaseUnusedBudget('user-1', 'res-123', 120);

    expect(result.remaining).toEqual(updatedBalance);
  });
});

describe('recordStepUsage', () => {
  beforeEach(resetMocks);

  it('inserts an audit row with step metadata', async () => {
    // First query: lookup userId from reservation
    mockNeonSqlResults.push([{ user_id: 'user-1' }]);
    // Second query: insert audit row (returns nothing)
    mockNeonSqlResults.push([]);

    await recordStepUsage('res-123', 'step-1', 25);

    // Two queries: lookup + insert
    expect(mockNeonSql).toHaveBeenCalledTimes(2);
  });

  it('skips insert for zero tokens', async () => {
    await recordStepUsage('res-123', 'step-1', 0);

    expect(mockNeonSql).not.toHaveBeenCalled();
  });

  it('skips insert for negative tokens', async () => {
    await recordStepUsage('res-123', 'step-1', -5);

    expect(mockNeonSql).not.toHaveBeenCalled();
  });

  it('skips insert for free reservations', async () => {
    await recordStepUsage('free', 'step-1', 25);

    expect(mockNeonSql).not.toHaveBeenCalled();
  });

  it('handles missing reservation gracefully', async () => {
    mockNeonSqlResults.push([]);

    await recordStepUsage('nonexistent', 'step-1', 25);

    // Only lookup query, no insert
    expect(mockNeonSql).toHaveBeenCalledTimes(1);
  });
});
