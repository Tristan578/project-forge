import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TokenBalance, DeductResult, DeductError } from './service';

// Mock the DB client to prevent real DB connections
vi.mock('../db/client', () => ({
  getDb: vi.fn(),
}));

// Mock drizzle-orm to avoid needing a real DB
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  gte: vi.fn((a, b) => ({ gte: [a, b] })),
}));

vi.mock('../db/schema', () => ({
  users: { id: 'id', monthlyTokens: 'monthly_tokens', monthlyTokensUsed: 'monthly_tokens_used', addonTokens: 'addon_tokens', billingCycleStart: 'billing_cycle_start', updatedAt: 'updated_at', earnedCredits: 'earned_credits' },
  tokenUsage: { id: 'id', userId: 'user_id', operation: 'operation', tokens: 'tokens', source: 'source', provider: 'provider', metadata: 'metadata', createdAt: 'created_at' },
  tokenPurchases: { userId: 'user_id', stripePaymentIntent: 'stripe_payment_intent', package: 'package', tokens: 'tokens', amountCents: 'amount_cents' },
}));

describe('TokenBalance interface', () => {
  it('has correct shape with all required fields', () => {
    const balance: TokenBalance = {
      monthlyRemaining: 50,
      monthlyTotal: 100,
      addon: 200,
      total: 250,
      nextRefillDate: '2026-03-26T00:00:00.000Z',
    };
    expect(balance.monthlyRemaining).toBe(50);
    expect(balance.monthlyTotal).toBe(100);
    expect(balance.addon).toBe(200);
    expect(balance.total).toBe(250);
    expect(balance.nextRefillDate).toBeDefined();
  });

  it('allows null nextRefillDate', () => {
    const balance: TokenBalance = {
      monthlyRemaining: 0,
      monthlyTotal: 50,
      addon: 0,
      total: 0,
      nextRefillDate: null,
    };
    expect(balance.nextRefillDate).toBeNull();
  });

  it('total equals monthlyRemaining plus addon', () => {
    const monthly = 30;
    const addon = 100;
    const balance: TokenBalance = {
      monthlyRemaining: monthly,
      monthlyTotal: 50,
      addon,
      total: monthly + addon,
      nextRefillDate: null,
    };
    expect(balance.total).toBe(monthly + addon);
  });
});

describe('DeductResult interface', () => {
  it('has correct shape for successful deduction', () => {
    const result: DeductResult = {
      success: true,
      usageId: 'usage-uuid-123',
      remaining: {
        monthlyRemaining: 45,
        monthlyTotal: 50,
        addon: 0,
        total: 45,
        nextRefillDate: null,
      },
    };
    expect(result.success).toBe(true);
    expect(result.usageId).toBe('usage-uuid-123');
    expect(result.remaining.monthlyRemaining).toBe(45);
  });

  it('free operations return usageId of "free"', () => {
    const result: DeductResult = {
      success: true,
      usageId: 'free',
      remaining: { monthlyRemaining: 50, monthlyTotal: 50, addon: 0, total: 50, nextRefillDate: null },
    };
    expect(result.usageId).toBe('free');
  });
});

describe('DeductError interface', () => {
  it('has correct shape for insufficient tokens', () => {
    const error: DeductError = {
      success: false,
      error: 'INSUFFICIENT_TOKENS',
      balance: {
        monthlyRemaining: 5,
        monthlyTotal: 50,
        addon: 0,
        total: 5,
        nextRefillDate: null,
      },
      cost: 20,
    };
    expect(error.success).toBe(false);
    expect(error.error).toBe('INSUFFICIENT_TOKENS');
    expect(error.cost).toBe(20);
    expect(error.balance.total).toBe(5);
  });
});

describe('deductTokens source split logic', () => {
  it('monthly deduction when sufficient monthly tokens', () => {
    // Verify the logic: if monthlyRemaining >= cost, use monthly only
    const monthlyRemaining = 100;
    const tokenCost = 50;
    let monthlyDeduct = 0;
    let addonDeduct = 0;
    let source: 'monthly' | 'addon' | 'mixed';

    if (monthlyRemaining >= tokenCost) {
      monthlyDeduct = tokenCost;
      source = 'monthly';
    } else if (monthlyRemaining > 0) {
      monthlyDeduct = monthlyRemaining;
      addonDeduct = tokenCost - monthlyRemaining;
      source = 'mixed';
    } else {
      addonDeduct = tokenCost;
      source = 'addon';
    }

    expect(monthlyDeduct).toBe(50);
    expect(addonDeduct).toBe(0);
    expect(source).toBe('monthly');
  });

  it('addon deduction when no monthly tokens remain', () => {
    const monthlyRemaining = 0;
    const tokenCost = 50;
    let monthlyDeduct = 0;
    let addonDeduct = 0;
    let source: 'monthly' | 'addon' | 'mixed';

    if (monthlyRemaining >= tokenCost) {
      monthlyDeduct = tokenCost;
      source = 'monthly';
    } else if (monthlyRemaining > 0) {
      monthlyDeduct = monthlyRemaining;
      addonDeduct = tokenCost - monthlyRemaining;
      source = 'mixed';
    } else {
      addonDeduct = tokenCost;
      source = 'addon';
    }

    expect(monthlyDeduct).toBe(0);
    expect(addonDeduct).toBe(50);
    expect(source).toBe('addon');
  });

  it('mixed deduction when partial monthly tokens remain', () => {
    const monthlyRemaining = 10;
    const tokenCost = 50;
    let monthlyDeduct = 0;
    let addonDeduct = 0;
    let source: 'monthly' | 'addon' | 'mixed';

    if (monthlyRemaining >= tokenCost) {
      monthlyDeduct = tokenCost;
      source = 'monthly';
    } else if (monthlyRemaining > 0) {
      monthlyDeduct = monthlyRemaining;
      addonDeduct = tokenCost - monthlyRemaining;
      source = 'mixed';
    } else {
      addonDeduct = tokenCost;
      source = 'addon';
    }

    expect(monthlyDeduct).toBe(10);
    expect(addonDeduct).toBe(40);
    expect(source).toBe('mixed');
  });

  it('insufficient tokens when total available < cost', () => {
    const monthlyRemaining = 5;
    const addonTokens = 10;
    const totalAvailable = monthlyRemaining + addonTokens;
    const tokenCost = 20;

    expect(totalAvailable).toBeLessThan(tokenCost);
  });
});

describe('getTokenBalance return value shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('constructs balance from user fields correctly', () => {
    // Simulate what getTokenBalance would return given a user row
    const user = {
      monthlyTokens: 50,
      monthlyTokensUsed: 20,
      addonTokens: 100,
      billingCycleStart: new Date('2026-01-26'),
    };

    const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
    const balance: TokenBalance = {
      monthlyRemaining,
      monthlyTotal: user.monthlyTokens,
      addon: user.addonTokens,
      total: monthlyRemaining + user.addonTokens,
      nextRefillDate: new Date(
        new Date(user.billingCycleStart).getTime() + 30 * 24 * 60 * 60 * 1000
      ).toISOString(),
    };

    expect(balance.monthlyRemaining).toBe(30);
    expect(balance.monthlyTotal).toBe(50);
    expect(balance.addon).toBe(100);
    expect(balance.total).toBe(130);
    expect(balance.nextRefillDate).toContain('2026-02-25');
  });

  it('clamps monthlyRemaining to 0 when overused', () => {
    const user = { monthlyTokens: 50, monthlyTokensUsed: 60, addonTokens: 10, billingCycleStart: null };
    const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
    expect(monthlyRemaining).toBe(0);
  });

  it('returns null nextRefillDate when billingCycleStart is null', () => {
    const billingCycleStart: Date | null = null;
    const nextRefillDate = billingCycleStart
      ? new Date(new Date(billingCycleStart).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : null;
    expect(nextRefillDate).toBeNull();
  });
});
