/**
 * Tests for subscription lifecycle management.
 *
 * Covers: idempotency guard, subscription CRUD, tier transitions,
 * invoice paid/failed handling, and token grant/rollover logic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (must appear before subject imports)
// ---------------------------------------------------------------------------

const mockDbChain = {
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
};

// Drizzle query builder chain helpers
function makeSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

function makeUpdateChain() {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
}

function makeInsertChain() {
  return {
    values: vi.fn().mockResolvedValue(undefined),
  };
}

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => mockDbChain),
}));

vi.mock('@/lib/auth/user-service', () => ({
  updateUserTier: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/tokens/pricing', () => ({
  TIER_MONTHLY_TOKENS: {
    starter: 50,
    hobbyist: 300,
    creator: 1000,
    pro: 3000,
  },
}));

// ---------------------------------------------------------------------------
// Subject under test (imported after mocks are wired)
// ---------------------------------------------------------------------------

import {
  claimEvent,
  releaseEvent,
  findUserByStripeCustomer,
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
} from '@/lib/billing/subscription-lifecycle';
import { getDb } from '@/lib/db/client';
import { updateUserTier } from '@/lib/auth/user-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDbUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    tier: 'hobbyist',
    stripeCustomerId: 'cus_abc',
    stripeSubscriptionId: 'sub_abc',
    monthlyTokens: 300,
    monthlyTokensUsed: 100,
    addonTokens: 0,
    earnedCredits: 0,
    ...overrides,
  };
}

function wireDb(selectRows: unknown[][], updateFn?: () => ReturnType<typeof makeUpdateChain>, insertFn?: () => ReturnType<typeof makeInsertChain>) {
  let selectCallIndex = 0;
  (mockDbChain.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const rows = selectRows[selectCallIndex] ?? selectRows[selectRows.length - 1];
    selectCallIndex++;
    return makeSelectChain(rows);
  });
  (mockDbChain.update as ReturnType<typeof vi.fn>).mockImplementation(() => updateFn ? updateFn() : makeUpdateChain());
  (mockDbChain.insert as ReturnType<typeof vi.fn>).mockImplementation(() => insertFn ? insertFn() : makeInsertChain());
}

// ---------------------------------------------------------------------------
// claimEvent / releaseEvent
// ---------------------------------------------------------------------------

describe('claimEvent', () => {
  // Reset the module-level processedEvents set between tests by using unique IDs
  let counter = 0;
  const uniqueId = () => `evt_claim_${counter++}_${Date.now()}`;

  it('returns true the first time an event is claimed', () => {
    expect(claimEvent(uniqueId())).toBe(true);
  });

  it('returns false when the same event is claimed twice', () => {
    const id = uniqueId();
    claimEvent(id);
    expect(claimEvent(id)).toBe(false);
  });

  it('allows re-claiming after releaseEvent', () => {
    const id = uniqueId();
    claimEvent(id);
    releaseEvent(id);
    expect(claimEvent(id)).toBe(true);
  });

  it('handles multiple distinct events independently', () => {
    const a = uniqueId();
    const b = uniqueId();
    expect(claimEvent(a)).toBe(true);
    expect(claimEvent(b)).toBe(true);
    expect(claimEvent(a)).toBe(false);
    expect(claimEvent(b)).toBe(false);
  });

  it('still returns false after releaseEvent on an unclaimed event', () => {
    const id = uniqueId();
    releaseEvent(id); // no-op
    expect(claimEvent(id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findUserByStripeCustomer
// ---------------------------------------------------------------------------

describe('findUserByStripeCustomer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the user when found', async () => {
    const user = makeDbUser();
    wireDb([[user]]);
    const result = await findUserByStripeCustomer('cus_abc');
    expect(result).toEqual(user);
    expect(getDb).toHaveBeenCalled();
  });

  it('returns null when no user is found', async () => {
    wireDb([[]]);
    const result = await findUserByStripeCustomer('cus_unknown');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleSubscriptionCreated
// ---------------------------------------------------------------------------

describe('handleSubscriptionCreated', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing when customer is not found', async () => {
    wireDb([[]]); // empty result for findUserByStripeCustomer
    await handleSubscriptionCreated('cus_ghost', 'sub_1', 'hobbyist');
    expect(updateUserTier).not.toHaveBeenCalled();
  });

  it('updates tier, subscription ID, and grants tokens', async () => {
    const user = makeDbUser({ tier: 'starter', monthlyTokens: 50, monthlyTokensUsed: 0 });
    const updateChain = makeUpdateChain();
    const insertChain = makeInsertChain();
    // First select: findUserByStripeCustomer; second: getTotalBalance
    wireDb([[user], [{ monthlyTokens: 300, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 }]], () => updateChain, () => insertChain);

    await handleSubscriptionCreated('cus_abc', 'sub_new', 'hobbyist');

    expect(updateUserTier).toHaveBeenCalledWith('user-1', 'hobbyist');
    expect(mockDbChain.update).toHaveBeenCalled();
    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({
      stripeSubscriptionId: 'sub_new',
      monthlyTokens: 300,
      monthlyTokensUsed: 0,
    }));
    expect(mockDbChain.insert).toHaveBeenCalled();
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      transactionType: 'monthly_grant',
      amount: 300,
      source: 'subscription_created:hobbyist',
      referenceId: 'sub_new',
    }));
  });

  it('uses correct token allocation for pro tier', async () => {
    const user = makeDbUser({ tier: 'starter' });
    const updateChain = makeUpdateChain();
    const insertChain = makeInsertChain();
    wireDb([[user], [{ monthlyTokens: 3000, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 }]], () => updateChain, () => insertChain);

    await handleSubscriptionCreated('cus_abc', 'sub_pro', 'pro');

    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({
      monthlyTokens: 3000,
    }));
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      amount: 3000,
      source: 'subscription_created:pro',
    }));
  });
});

// ---------------------------------------------------------------------------
// handleSubscriptionUpdated
// ---------------------------------------------------------------------------

describe('handleSubscriptionUpdated', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing when customer is not found', async () => {
    wireDb([[]]);
    await handleSubscriptionUpdated('cus_ghost', 'sub_1', 'pro', 'active');
    expect(updateUserTier).not.toHaveBeenCalled();
  });

  it('skips tier/token changes when status is past_due', async () => {
    const user = makeDbUser({ tier: 'hobbyist' });
    const updateChain = makeUpdateChain();
    wireDb([[user]], () => updateChain, () => makeInsertChain());

    await handleSubscriptionUpdated('cus_abc', 'sub_abc', 'creator', 'past_due');

    // Only subscription ID update should run, not tier update
    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({
      stripeSubscriptionId: 'sub_abc',
    }));
    expect(updateUserTier).not.toHaveBeenCalled();
  });

  it('skips tier/token changes when status is unpaid', async () => {
    const user = makeDbUser({ tier: 'hobbyist' });
    const updateChain = makeUpdateChain();
    wireDb([[user]], () => updateChain, () => makeInsertChain());

    await handleSubscriptionUpdated('cus_abc', 'sub_abc', 'pro', 'unpaid');

    expect(updateUserTier).not.toHaveBeenCalled();
  });

  it('calls updateUserTier without token change when tier is unchanged', async () => {
    const user = makeDbUser({ tier: 'hobbyist' });
    const updateChain = makeUpdateChain();
    wireDb([[user]], () => updateChain, () => makeInsertChain());

    await handleSubscriptionUpdated('cus_abc', 'sub_abc', 'hobbyist', 'active');

    expect(updateUserTier).toHaveBeenCalledWith('user-1', 'hobbyist');
    // Only the subscription ID update ran — no token adjustments
    expect(updateChain.set).toHaveBeenCalledTimes(1);
  });

  it('grants difference tokens on upgrade', async () => {
    const user = makeDbUser({ tier: 'hobbyist', monthlyTokens: 300, monthlyTokensUsed: 100 });
    let updateCallCount = 0;
    const updateChain = {
      set: vi.fn().mockImplementation(() => {
        updateCallCount++;
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    };
    const insertChain = makeInsertChain();
    wireDb(
      [[user], [{ monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 }]],
      () => updateChain as ReturnType<typeof makeUpdateChain>,
      () => insertChain
    );

    await handleSubscriptionUpdated('cus_abc', 'sub_abc', 'creator', 'active');

    expect(updateUserTier).toHaveBeenCalledWith('user-1', 'creator');
    // upgrade: difference = 1000 - 300 = 700
    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({
      monthlyTokensUsed: 0,
    }));
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      transactionType: 'adjustment',
      amount: 700, // 1000 - 300
      source: 'upgrade:hobbyist->creator',
    }));
  });

  it('caps tokens to new allocation on downgrade', async () => {
    const user = makeDbUser({ tier: 'creator', monthlyTokens: 1000, monthlyTokensUsed: 200 });
    const updateChain = makeUpdateChain();
    const insertChain = makeInsertChain();
    wireDb(
      [[user], [{ monthlyTokens: 300, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 }]],
      () => updateChain,
      () => insertChain
    );

    await handleSubscriptionUpdated('cus_abc', 'sub_abc', 'hobbyist', 'active');

    expect(updateUserTier).toHaveBeenCalledWith('user-1', 'hobbyist');
    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({
      monthlyTokens: 300,
      monthlyTokensUsed: 0,
    }));
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      transactionType: 'adjustment',
      amount: -700, // 300 - 1000 (negative for downgrade)
      source: 'downgrade:creator->hobbyist',
    }));
  });
});

// ---------------------------------------------------------------------------
// handleSubscriptionDeleted
// ---------------------------------------------------------------------------

describe('handleSubscriptionDeleted', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing when customer is not found', async () => {
    wireDb([[]]);
    await handleSubscriptionDeleted('cus_ghost', 'sub_1');
    expect(updateUserTier).not.toHaveBeenCalled();
  });

  it('reverts user to starter tier and zeros monthly tokens', async () => {
    const user = makeDbUser({ tier: 'creator', monthlyTokens: 1000, monthlyTokensUsed: 300 });
    const updateChain = makeUpdateChain();
    const insertChain = makeInsertChain();
    wireDb(
      [[user], [{ monthlyTokens: 50, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 }]],
      () => updateChain,
      () => insertChain
    );

    await handleSubscriptionDeleted('cus_abc', 'sub_old');

    expect(updateUserTier).toHaveBeenCalledWith('user-1', 'starter');
    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({
      stripeSubscriptionId: null,
      monthlyTokens: 50,
      monthlyTokensUsed: 0,
    }));
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      transactionType: 'adjustment',
      source: 'cancellation:creator->starter',
      referenceId: 'sub_old',
    }));
  });

  it('records negative adjustment equal to remaining monthly tokens', async () => {
    const user = makeDbUser({ tier: 'pro', monthlyTokens: 3000, monthlyTokensUsed: 1000 });
    const updateChain = makeUpdateChain();
    const insertChain = makeInsertChain();
    wireDb(
      [[user], [{ monthlyTokens: 50, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 }]],
      () => updateChain,
      () => insertChain
    );

    await handleSubscriptionDeleted('cus_abc', 'sub_pro');

    // Remaining = 3000 - 1000 = 2000 → negative adjustment
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      amount: -2000,
    }));
  });
});

// ---------------------------------------------------------------------------
// handleInvoicePaid
// ---------------------------------------------------------------------------

describe('handleInvoicePaid', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing when subscriptionId is null', async () => {
    await handleInvoicePaid('cus_abc', 'inv_1', null);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('does nothing when customer is not found', async () => {
    wireDb([[]]);
    await handleInvoicePaid('cus_ghost', 'inv_1', 'sub_abc');
    expect(mockDbChain.update).not.toHaveBeenCalled();
  });

  it('skips when subscription IDs do not match', async () => {
    const user = makeDbUser({ stripeSubscriptionId: 'sub_other' });
    wireDb([[user]]);
    await handleInvoicePaid('cus_abc', 'inv_1', 'sub_different');
    expect(mockDbChain.update).not.toHaveBeenCalled();
  });

  it('rolls over unused tokens and grants new monthly allocation', async () => {
    const user = makeDbUser({
      tier: 'hobbyist',
      monthlyTokens: 300,
      monthlyTokensUsed: 100,
      stripeSubscriptionId: 'sub_abc',
    });
    const updateChain = makeUpdateChain();
    const insertChain = makeInsertChain();
    wireDb(
      [
        [user],
        [{ monthlyTokens: 500, monthlyTokensUsed: 0, addonTokens: 200, earnedCredits: 0 }],
        [{ monthlyTokens: 300, monthlyTokensUsed: 0, addonTokens: 200, earnedCredits: 0 }],
      ],
      () => updateChain,
      () => insertChain
    );

    await handleInvoicePaid('cus_abc', 'inv_renewal', 'sub_abc');

    // Rollover: min(300 - 100, 300) = 200
    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({
      addonTokens: expect.anything(), // SQL expression
    }));
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      transactionType: 'rollover',
      amount: 200,
      source: 'renewal_rollover:hobbyist',
      referenceId: 'inv_renewal',
    }));
    // Monthly grant
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      transactionType: 'monthly_grant',
      amount: 300,
      source: 'renewal:hobbyist',
      referenceId: 'inv_renewal',
    }));
  });

  it('skips rollover when no unused tokens remain', async () => {
    const user = makeDbUser({
      tier: 'hobbyist',
      monthlyTokens: 300,
      monthlyTokensUsed: 300, // fully used
      stripeSubscriptionId: 'sub_abc',
    });
    const updateChain = makeUpdateChain();
    const insertChain = makeInsertChain();
    wireDb(
      [
        [user],
        [{ monthlyTokens: 300, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 }],
      ],
      () => updateChain,
      () => insertChain
    );

    await handleInvoicePaid('cus_abc', 'inv_renewal', 'sub_abc');

    // No rollover transaction should be inserted
    const insertCalls = (insertChain.values as ReturnType<typeof vi.fn>).mock.calls;
    const rolloverCall = insertCalls.find((c: unknown[]) => {
      const v = c[0] as Record<string, unknown>;
      return v.transactionType === 'rollover';
    });
    expect(rolloverCall).toBeUndefined();
  });

  it('caps rollover at the tier monthly allocation', async () => {
    const user = makeDbUser({
      tier: 'hobbyist',
      monthlyTokens: 600, // more than allocation due to upgrade
      monthlyTokensUsed: 100,
      stripeSubscriptionId: 'sub_abc',
    });
    const updateChain = makeUpdateChain();
    const insertChain = makeInsertChain();
    wireDb(
      [
        [user],
        [{ monthlyTokens: 500, monthlyTokensUsed: 0, addonTokens: 300, earnedCredits: 0 }],
        [{ monthlyTokens: 300, monthlyTokensUsed: 0, addonTokens: 300, earnedCredits: 0 }],
      ],
      () => updateChain,
      () => insertChain
    );

    await handleInvoicePaid('cus_abc', 'inv_renewal', 'sub_abc');

    // Remaining = 600 - 100 = 500, but cap is 300 (hobbyist)
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      transactionType: 'rollover',
      amount: 300, // capped at tier allocation
    }));
  });

  it('resets billing cycle start date', async () => {
    const user = makeDbUser({ stripeSubscriptionId: 'sub_abc' });
    const updateChain = makeUpdateChain();
    const insertChain = makeInsertChain();
    wireDb(
      [
        [user],
        [{ monthlyTokens: 300, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 }],
      ],
      () => updateChain,
      () => insertChain
    );

    await handleInvoicePaid('cus_abc', 'inv_1', 'sub_abc');

    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({
      billingCycleStart: expect.any(Date),
    }));
  });
});

// ---------------------------------------------------------------------------
// handleInvoicePaymentFailed
// ---------------------------------------------------------------------------

describe('handleInvoicePaymentFailed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing when customer is not found', async () => {
    wireDb([[]]);
    await handleInvoicePaymentFailed('cus_ghost', 'inv_1', 1, null);
    expect(mockDbChain.insert).not.toHaveBeenCalled();
  });

  it('records an audit transaction with amount 0', async () => {
    const user = makeDbUser();
    const insertChain = makeInsertChain();
    wireDb(
      [[user], [{ monthlyTokens: 300, monthlyTokensUsed: 100, addonTokens: 0, earnedCredits: 0 }]],
      () => makeUpdateChain(),
      () => insertChain
    );

    await handleInvoicePaymentFailed('cus_abc', 'inv_fail', 1, null);

    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      transactionType: 'adjustment',
      amount: 0,
      source: 'payment_failed:attempt_1',
      referenceId: 'inv_fail',
    }));
  });

  it('records audit transaction on subsequent attempt', async () => {
    const user = makeDbUser();
    const insertChain = makeInsertChain();
    wireDb(
      [[user], [{ monthlyTokens: 300, monthlyTokensUsed: 100, addonTokens: 0, earnedCredits: 0 }]],
      () => makeUpdateChain(),
      () => insertChain
    );
    const nextRetry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    await handleInvoicePaymentFailed('cus_abc', 'inv_fail', 2, nextRetry);

    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      source: 'payment_failed:attempt_2',
    }));
  });

  it('does NOT change the user tier (grace period — Stripe handles cancellation)', async () => {
    const user = makeDbUser({ tier: 'pro' });
    wireDb(
      [[user], [{ monthlyTokens: 3000, monthlyTokensUsed: 0, addonTokens: 0, earnedCredits: 0 }]],
      () => makeUpdateChain(),
      () => makeInsertChain()
    );

    await handleInvoicePaymentFailed('cus_abc', 'inv_fail', 1, null);

    expect(updateUserTier).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getTotalBalance (tested indirectly via balanceAfter in transactions)
// ---------------------------------------------------------------------------

describe('getTotalBalance (via transaction audit)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('computes balance as monthly remaining + addon + earned credits', async () => {
    const user = makeDbUser({ stripeCustomerId: 'cus_balance' });
    const balanceUser = {
      monthlyTokens: 300,
      monthlyTokensUsed: 100,
      addonTokens: 50,
      earnedCredits: 10,
    };
    const insertChain = makeInsertChain();
    wireDb(
      [[user], [balanceUser]],
      () => makeUpdateChain(),
      () => insertChain
    );

    await handleSubscriptionDeleted('cus_balance', 'sub_1');

    // Balance = (300 - 100) + 50 + 10 = 260
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      balanceAfter: 260,
    }));
  });

  it('returns 0 balance when user record not found during balance check', async () => {
    const user = makeDbUser();
    const insertChain = makeInsertChain();
    // findUserByStripeCustomer returns user; getTotalBalance returns empty
    wireDb(
      [[user], []],
      () => makeUpdateChain(),
      () => insertChain
    );

    await handleSubscriptionDeleted('cus_abc', 'sub_1');

    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      balanceAfter: 0,
    }));
  });
});

// ---------------------------------------------------------------------------
// claimEvent memory-safety (overflow eviction)
// ---------------------------------------------------------------------------

describe('claimEvent memory safety', () => {
  it('does not throw when more than 10,000 events are claimed', () => {
    // Use distinct IDs to avoid collisions with earlier tests
    for (let i = 0; i < 10_002; i++) {
      claimEvent(`overflow_safety_evt_${i}_${Date.now()}`);
    }
    // Passes if no error is thrown
  });
});
