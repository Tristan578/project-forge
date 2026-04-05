/**
 * PF-686: Auth edge case tests.
 *
 * Covers scenarios not covered by api-auth.test.ts:
 * - Tier downgrade during active session (session says creator, DB says starter)
 * - Concurrent token deductions — optimistic locking retry behavior
 * - Token balance reflects deducted state immediately
 * - Missing Clerk keys graceful degradation
 * - assertTier correctly blocks downgraded users mid-session
 *
 * Note: The core auth function edge cases (expired tokens, empty userId,
 * SERVICE_DEGRADED) are already exhaustively tested in api-auth.test.ts.
 * This file focuses on session lifetime / token-deduction edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbInsert = vi.fn();

const mockDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => mockDbSelect(),
      }),
    }),
  }),
  update: () => ({
    set: () => ({
      where: () => ({
        returning: () => mockDbUpdate(),
      }),
    }),
  }),
  insert: () => ({
    values: () => ({
      returning: () => mockDbInsert(),
    }),
  }),
};

const mockNeonSql = Object.assign(vi.fn().mockResolvedValue([]), {
  transaction: vi.fn().mockResolvedValue([]),
});

vi.mock('@/lib/db/client', () => ({
  getDb: () => mockDb,
  getNeonSql: () => mockNeonSql,
  queryWithResilience: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

// Stub drizzle sql/eq/and/gte — they just need to produce opaque tokens
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  sql: vi.fn((_tpl: TemplateStringsArray, ..._vals: unknown[]) => ({ type: 'sql' })),
  and: vi.fn((..._conds: unknown[]) => ({ type: 'and' })),
  gte: vi.fn((_col: unknown, val: unknown) => ({ type: 'gte', val })),
}));

vi.mock('@/lib/db/schema', () => ({
  users: { id: 'users.id', monthlyTokens: 'users.monthlyTokens', monthlyTokensUsed: 'users.monthlyTokensUsed', addonTokens: 'users.addonTokens' },
  tokenUsage: { id: 'tokenUsage.id', userId: 'tokenUsage.userId', source: 'tokenUsage.source', tokens: 'tokenUsage.tokens', provider: 'tokenUsage.provider' },
  tokenPurchases: {},
}));

vi.mock('@/lib/tokens/pricing', () => ({
  TIER_MONTHLY_TOKENS: {
    starter: 500,
    hobbyist: 2000,
    creator: 10000,
    pro: 50000,
  },
  TOKEN_PACKAGES: {},
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { deductTokens, getTokenBalance, refundTokens } from '@/lib/tokens/service';
import { assertTier } from '@/lib/auth/api-auth';
import type { User } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<User> = {}): User {
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
  } as User;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tier downgrade during active session (PF-686)
// ---------------------------------------------------------------------------

describe('assertTier — tier downgrade mid-session', () => {
  it('blocks a user whose tier was downgraded from creator to starter in DB', () => {
    // The session may have been started when user was creator, but the DB
    // record (which we always read fresh) now says starter.
    const user = makeUser({ tier: 'starter' });
    const response = assertTier(user, ['creator', 'pro']);
    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
  });

  it('allows access for a user who was upgraded from starter to creator', () => {
    // Upgrade mid-session — DB record now says creator, grant access.
    const user = makeUser({ tier: 'creator' });
    const response = assertTier(user, ['creator', 'pro']);
    expect(response).toBeNull();
  });

  it('includes currentTier in 403 body so client can redirect to upgrade page', async () => {
    const user = makeUser({ tier: 'hobbyist' });
    const response = assertTier(user, ['creator', 'pro']);
    expect(response).not.toBeNull();
    const body = await response!.json();
    expect(body.currentTier).toBe('hobbyist');
    expect(body.error).toBe('TIER_REQUIRED');
  });
});

// ---------------------------------------------------------------------------
// getTokenBalance — PF-686: balance computation edge cases
// ---------------------------------------------------------------------------

describe('getTokenBalance — edge cases', () => {
  it('throws when user is not found', async () => {
    mockDbSelect.mockResolvedValue([]);
    await expect(getTokenBalance('nonexistent-user')).rejects.toThrow('User not found');
  });

  it('returns zero monthlyRemaining when user is fully depleted', async () => {
    mockDbSelect.mockResolvedValue([makeUser({ monthlyTokens: 500, monthlyTokensUsed: 500, addonTokens: 0 })]);
    const balance = await getTokenBalance('user-1');
    expect(balance.monthlyRemaining).toBe(0);
    expect(balance.total).toBe(0);
  });

  it('clamps monthlyRemaining to zero (never negative) if DB is inconsistent', async () => {
    // monthlyTokensUsed > monthlyTokens — shouldn't happen but Math.max guards it
    mockDbSelect.mockResolvedValue([makeUser({ monthlyTokens: 500, monthlyTokensUsed: 600, addonTokens: 50 })]);
    const balance = await getTokenBalance('user-1');
    expect(balance.monthlyRemaining).toBe(0);
    expect(balance.total).toBe(50); // only addon tokens
  });

  it('returns correct total when addon tokens are available', async () => {
    mockDbSelect.mockResolvedValue([makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 800, addonTokens: 200 })]);
    const balance = await getTokenBalance('user-1');
    expect(balance.monthlyRemaining).toBe(200);
    expect(balance.addon).toBe(200);
    expect(balance.total).toBe(400);
  });

  it('returns null nextRefillDate when billingCycleStart is null', async () => {
    mockDbSelect.mockResolvedValue([makeUser({ billingCycleStart: null })]);
    const balance = await getTokenBalance('user-1');
    expect(balance.nextRefillDate).toBeNull();
  });

  it('returns ISO nextRefillDate when billingCycleStart is set', async () => {
    const cycleStart = new Date('2026-01-01T00:00:00.000Z');
    mockDbSelect.mockResolvedValue([makeUser({ billingCycleStart: cycleStart })]);
    const balance = await getTokenBalance('user-1');
    expect(balance.nextRefillDate).toBe('2026-01-31T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// deductTokens — concurrent / race condition handling (PF-686)
// ---------------------------------------------------------------------------

describe('deductTokens — concurrent token deductions', () => {
  it('returns DeductResult for free operations (tokenCost = 0)', async () => {
    mockDbSelect.mockResolvedValue([makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0 })]);
    const result = await deductTokens('user-1', 'test_op', 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.usageId).toBe('free');
    }
  });

  it('returns INSUFFICIENT_TOKENS when balance is too low', async () => {
    mockDbSelect.mockResolvedValue([makeUser({ monthlyTokens: 100, monthlyTokensUsed: 90, addonTokens: 0 })]);
    const result = await deductTokens('user-1', 'chat', 50);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('INSUFFICIENT_TOKENS');
      expect(result.cost).toBe(50);
    }
  });

  it('deducts from monthly tokens when sufficient', async () => {
    mockDbSelect.mockResolvedValue([makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0 })]);
    // neonSql tagged-template calls: first = UPDATE RETURNING, second = INSERT RETURNING
    mockNeonSql
      .mockResolvedValueOnce([{ id: 'user-1' }])      // UPDATE ... RETURNING id
      .mockResolvedValueOnce([{ id: 'usage-uuid-1' }]); // INSERT ... RETURNING id
    // getTokenBalance after deduction reads via Drizzle select
    mockDbSelect.mockResolvedValueOnce([makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0 })]);
    mockDbSelect.mockResolvedValueOnce([makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 100, addonTokens: 0 })]);

    const result = await deductTokens('user-1', 'chat', 100);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.usageId).toBe('usage-uuid-1');
    }
  });

  it('retries on race condition (updateResult empty) up to 3 times, then returns INSUFFICIENT_TOKENS', async () => {
    // First read: user has enough balance
    mockDbSelect.mockResolvedValue([makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0 })]);
    // Atomic neonSql UPDATE always returns [] — simulates perpetual race condition
    mockNeonSql.mockResolvedValue([]);

    const result = await deductTokens('user-1', 'chat', 100, undefined, undefined, 3);
    // At retry count 3, should bail out with INSUFFICIENT_TOKENS
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('INSUFFICIENT_TOKENS');
    }
  });

  it('negative tokenCost is treated as free (no deduction)', async () => {
    mockDbSelect.mockResolvedValue([makeUser({ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0 })]);
    const result = await deductTokens('user-1', 'test_op', -10);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.usageId).toBe('free');
    }
  });
});

// ---------------------------------------------------------------------------
// refundTokens — edge cases
// ---------------------------------------------------------------------------

describe('refundTokens — edge cases', () => {
  it('does nothing for free usage (usageId = "free")', async () => {
    await refundTokens('user-1', 'free');
    // No DB calls should happen
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('does nothing when usage record is not found', async () => {
    // select returns empty — record not found
    mockDbSelect.mockResolvedValue([]);
    await refundTokens('user-1', 'missing-usage-id');
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Missing Clerk keys — graceful degradation (PF-686)
// ---------------------------------------------------------------------------

describe('Clerk keys — missing key graceful degradation', () => {
  it('isClerkConfigured returns false when CLERK_SECRET_KEY is missing', async () => {
    const savedSecret = process.env.CLERK_SECRET_KEY;
    const savedPub = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

    delete process.env.CLERK_SECRET_KEY;
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_abc';

    // Re-import authenticateRequest to pick up env change
    vi.resetModules();
    vi.mock('@clerk/nextjs/server', () => ({
      auth: vi.fn(),
      clerkClient: vi.fn(),
    }));
    vi.mock('@/lib/auth/user-service', () => ({
      getUserByClerkId: vi.fn(),
      syncUserFromClerk: vi.fn(),
    }));

    const { authenticateRequest } = await import('@/lib/auth/api-auth');
    const result = await authenticateRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }

    // Restore
    if (savedSecret) process.env.CLERK_SECRET_KEY = savedSecret;
    else delete process.env.CLERK_SECRET_KEY;
    if (savedPub) process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = savedPub;
    else delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  });

  it('isClerkConfigured returns false when NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is missing', async () => {
    const savedSecret = process.env.CLERK_SECRET_KEY;
    const savedPub = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

    process.env.CLERK_SECRET_KEY = 'sk_test_abc';
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

    vi.resetModules();
    vi.mock('@clerk/nextjs/server', () => ({
      auth: vi.fn(),
      clerkClient: vi.fn(),
    }));
    vi.mock('@/lib/auth/user-service', () => ({
      getUserByClerkId: vi.fn(),
      syncUserFromClerk: vi.fn(),
    }));

    const { authenticateClerkSession } = await import('@/lib/auth/api-auth');
    const result = await authenticateClerkSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }

    // Restore
    if (savedSecret) process.env.CLERK_SECRET_KEY = savedSecret;
    else delete process.env.CLERK_SECRET_KEY;
    if (savedPub) process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = savedPub;
    else delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  });
});
