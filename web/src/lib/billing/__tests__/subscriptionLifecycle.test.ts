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

// Neon SQL mock — tagged template returns Promise (for CTE queries) and also provides .transaction()
const mockNeonTransaction = vi.fn().mockResolvedValue([]);
const mockNeonSqlCalls: { strings: TemplateStringsArray; values: unknown[] }[] = [];
const mockNeonSql = Object.assign(
  vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]): Promise<unknown[]> => {
    mockNeonSqlCalls.push({ strings: _strings, values: _values });
    return Promise.resolve([]);
  }),
  { transaction: mockNeonTransaction },
);

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => mockDb),
  getNeonSql: vi.fn(() => mockNeonSql),
  queryWithResilience: vi.fn((fn: () => Promise<unknown>) => fn()),
}));
vi.mock('@/lib/tokens/pricing', () => ({
  TIER_MONTHLY_TOKENS: { starter: 10000, hobbyist: 50000, creator: 150000, pro: 500000 },
}));

import {
  findUserByStripeCustomer,
  handleSubscriptionDeleted,
  handleSubscriptionUpdated,
  handleEntitlementsUpdated,
} from '../subscription-lifecycle';

const mockUser = {
  id: 'user_abc', tier: 'creator', stripeCustomerId: 'cus_abc',
  stripeSubscriptionId: 'sub_abc', monthlyTokens: 150000,
  monthlyTokensUsed: 30000, addonTokens: 5000, earnedCredits: 0,
};

describe('subscription-lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNeonSqlCalls.length = 0;
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
      expect(mockNeonSqlCalls).toHaveLength(0);
    });

    it('reverts the tier in one neonSql statement, never db.transaction (PF-77, #8712)', async () => {
      await handleSubscriptionDeleted('cus_abc', 'sub_abc');

      // STRUCTURE ONLY. This mock suite proves the call SHAPE: a single atomic
      // neonSql tagged-template statement (a lone SQL statement is inherently
      // atomic — no transaction array needed) and never the broken
      // db.transaction(). It deliberately does NOT assert SQL substrings — that
      // would only prove the source contains certain literals, not that the
      // handler behaves. The audit-arbitrated reset and the tier-independent
      // `cancellation:%` idempotency anchor (#8712) are verified behaviourally,
      // against real Postgres, in subscriptionLifecycle.db.test.ts.
      expect(mockNeonTransaction).not.toHaveBeenCalled();
      expect(mockNeonSqlCalls).toHaveLength(1);
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
    mockNeonSqlCalls.length = 0;
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

  it('calls reverseAddonTokens for a full refund (fallback CTE path)', async () => {
    // Select 1: findUserByStripeCustomer -> mockUser
    mockSelectWhere
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([mockUser]) });
    await handleChargeRefunded('cus_abc', 'ch_full', 1000, 1000);
    // Fallback now uses a single CTE statement (not transaction) for atomicity (#8187)
    const cteCall = mockNeonSqlCalls.find(c =>
      c.strings.some(s => s.includes('audit'))
    );
    expect(cteCall).toBeDefined();
  });
});

describe('reverseAddonTokens (fallback path, no paymentIntentId)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNeonSqlCalls.length = 0;
    mockUpdateSet.mockReturnValue({ where: vi.fn().mockResolvedValue({}) });
  });

  it('does nothing when user not found', async () => {
    mockSelectWhere
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) });
    await reverseAddonTokens('ghost', 'ch_1', 500, 1000);
    expect(mockNeonTransaction).not.toHaveBeenCalled();
  });

  it('deducts proportional tokens for partial refund via CTE', async () => {
    await reverseAddonTokens('user_abc', 'ch_partial', 500, 1000);
    // Fallback now uses a single CTE statement (#8187)
    const cteCall = mockNeonSqlCalls.find(c =>
      c.strings.some(s => s.includes('audit'))
    );
    expect(cteCall).toBeDefined();
    // The CTE receives amountRefunded/amountTotal directly (no precomputed ratio);
    // refundRef encodes the cumulative refunded cents as `<chargeId>:<cents>`.
    expect(cteCall!.values).toContain(500);
    expect(cteCall!.values).toContain(1000);
    expect(cteCall!.values).toContain('charge_refunded:ch_partial');
    expect(cteCall!.values).toContain('ch_partial:500');
  });

  it('deducts all tokens for full refund via CTE', async () => {
    await reverseAddonTokens('user_abc', 'ch_full', 1000, 1000);
    const cteCall = mockNeonSqlCalls.find(c =>
      c.strings.some(s => s.includes('audit'))
    );
    expect(cteCall).toBeDefined();
    // Full refund: amountRefunded == amountTotal == 1000 (no precomputed ratio).
    expect(cteCall!.values).toContain(1000);
    expect(cteCall!.values).toContain('ch_full:1000');
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

describe('handleEntitlementsUpdated (PF-911 / #8821)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // vi.clearAllMocks() resets call history but NOT the `mockReturnValueOnce`
    // queue. Earlier describe blocks (e.g. reverseAddonTokens) enqueue one-time
    // return values that their handler can return early before consuming, so a
    // stale `[]` (user-not-found) would bleed into this block's first DB read
    // and make `findUserByStripeCustomer` return null — silently skipping the
    // UPDATE this block asserts on. mockReset() drains that queue so the suite
    // is hermetic regardless of describe order; we re-establish the default
    // user-found return immediately after.
    mockSelectWhere.mockReset();
    mockNeonSqlCalls.length = 0;
    mockSelectWhere.mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) });
  });

  it('does nothing when no user matches the customer', async () => {
    mockSelectWhere.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) });
    await expect(
      handleEntitlementsUpdated('cus_gone', { entitlements: { data: [] } })
    ).resolves.toBeUndefined();
    expect(mockNeonSqlCalls).toHaveLength(0);
  });

  it('persists the active feature lookup_keys as a jsonb array via a single UPDATE', async () => {
    const summary = {
      customer: 'cus_abc',
      entitlements: {
        data: [{ lookup_key: 'ai_generation' }, { lookup_key: 'publish_games' }],
      },
    };
    await handleEntitlementsUpdated('cus_abc', summary);

    // Exactly one statement, no transaction array (no audit row needed).
    expect(mockNeonTransaction).not.toHaveBeenCalled();
    expect(mockNeonSqlCalls).toHaveLength(1);

    const call = mockNeonSqlCalls[0];
    // The serialized feature array is bound as the first parameter.
    expect(call.values[0]).toBe(JSON.stringify(['ai_generation', 'publish_games']));
    // Bound to the resolved user id, not the raw customer id.
    expect(call.values).toContain('user_abc');
    // It's an UPDATE of active_features, cast to jsonb.
    const sql = call.strings.join('');
    expect(sql).toContain('UPDATE users');
    expect(sql).toContain('active_features');
    expect(sql).toContain('::jsonb');
  });

  it('persists an empty array (authoritative "no features") for an empty summary', async () => {
    await handleEntitlementsUpdated('cus_abc', { customer: 'cus_abc', entitlements: { data: [] } });
    expect(mockNeonSqlCalls).toHaveLength(1);
    expect(mockNeonSqlCalls[0].values[0]).toBe('[]');
  });

  it('tolerates a malformed summary without throwing (persists [])', async () => {
    await expect(handleEntitlementsUpdated('cus_abc', 'garbage')).resolves.toBeUndefined();
    expect(mockNeonSqlCalls).toHaveLength(1);
    expect(mockNeonSqlCalls[0].values[0]).toBe('[]');
  });

  // Regression for the mock-queue leak: a prior describe block could enqueue
  // an unconsumed `mockReturnValueOnce([])` (user-not-found) that bled into the
  // first DB read here, skipping the UPDATE (this block passed in isolation but
  // failed mid-file). vi.clearAllMocks() does NOT drain the once-queue; only
  // mockReset() does. This test stages exactly that leaked state, then runs the
  // hermetic-reset logic the beforeEach applies, and proves the next handler
  // read sees the real user. If someone reverts the beforeEach to clearAllMocks,
  // this fails.
  it('is hermetic against a leaked one-time user-not-found from a prior block', async () => {
    // Simulate the leak: an earlier block queued a stale empty result.
    mockSelectWhere.mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) });

    // The hermetic boundary the entitlements beforeEach establishes: drain the
    // once-queue and re-assert the default user-found return.
    mockSelectWhere.mockReset();
    mockSelectWhere.mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) });

    await handleEntitlementsUpdated('cus_abc', {
      customer: 'cus_abc',
      entitlements: { data: [{ lookup_key: 'ai_generation' }] },
    });

    // The user was resolved (not skipped), so the UPDATE ran exactly once.
    expect(mockNeonSqlCalls).toHaveLength(1);
    expect(mockNeonSqlCalls[0].values[0]).toBe(JSON.stringify(['ai_generation']));
  });
});
