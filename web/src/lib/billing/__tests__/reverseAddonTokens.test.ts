/**
 * Tests for reverseAddonTokens (PF-734).
 *
 * Verifies that:
 * 1. Refund tokens are calculated from the specific purchase, not user balance
 * 2. Idempotency prevents double-deduction on duplicate webhooks
 * 3. Partial refunds are tracked via refundedCents
 * 4. Fallback path works when no purchase record exists
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// --- Mock chain builders ---

const mockInsertValues = vi.fn().mockResolvedValue({});
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockUpdateWhere = vi.fn().mockResolvedValue({});
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

const mockSelectLimit = vi.fn().mockResolvedValue([]);
const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockDb = { insert: mockInsert, update: mockUpdate, select: mockSelect };

// Neon SQL mock for neonSql.transaction()
interface MockStatement { _type: 'neon_statement'; values: unknown[] }
const mockNeonTransaction = vi.fn<[MockStatement[]], Promise<unknown[]>>().mockResolvedValue([]);
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
}));
vi.mock('@/lib/tokens/pricing', () => ({
  TIER_MONTHLY_TOKENS: { starter: 10000, hobbyist: 50000, creator: 150000, pro: 500000 },
}));

import { reverseAddonTokens } from '../subscription-lifecycle';

// Helpers to configure mock select returns by call order
function configureSelectSequence(responses: unknown[][]) {
  // Each call to mockSelectLimit returns the next response in the sequence
  for (const response of responses) {
    mockSelectLimit.mockResolvedValueOnce(response);
  }
}

describe('reverseAddonTokens (PF-734)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockResolvedValue({});
  });

  describe('with paymentIntentId (purchase-based path)', () => {
    const purchase = {
      id: 'purchase-1',
      userId: 'user-1',
      stripePaymentIntent: 'pi_abc',
      package: 'blaze',
      tokens: 5000,
      amountCents: 4900,
      refundedCents: 0,
      createdAt: new Date(),
    };

    it('deducts tokens based on purchase token count, not user balance', async () => {
      // Select 1: tokenPurchases lookup -> finds purchase (5000 tokens, 4900 cents)
      // Select 2: users state -> user has 20000 addon tokens (from multiple purchases)
      configureSelectSequence([
        [purchase],
        [{ addonTokens: 20000, monthlyTokens: 0, monthlyTokensUsed: 0, earnedCredits: 0 }],
      ]);

      // Full refund of 4900 cents -> should deduct 5000 tokens (the purchase amount)
      // NOT 20000 (the user's total balance)
      await reverseAddonTokens('user-1', 'ch_abc', 4900, 4900, 'pi_abc');

      // All writes go through neonSql.transaction now (PF-77)
      expect(mockNeonTransaction).toHaveBeenCalledOnce();
      // Check deduction amount in INSERT statement (-5000)
      const allCalls = mockNeonSql.mock.calls;
      const insertCall = allCalls[allCalls.length - 1];
      const insertValues = insertCall.slice(1).flat();
      expect(insertValues).toContain(-5000);
      expect(insertValues).toContain('charge_refunded:ch_abc');
    });

    it('handles partial refund correctly', async () => {
      // 50% refund of a 4900 cent charge with 5000 tokens
      configureSelectSequence([
        [purchase],
        [{ addonTokens: 20000, monthlyTokens: 0, monthlyTokensUsed: 0, earnedCredits: 0 }],
      ]);

      await reverseAddonTokens('user-1', 'ch_abc', 2450, 4900, 'pi_abc');

      expect(mockNeonTransaction).toHaveBeenCalledOnce();
      const allCalls = mockNeonSql.mock.calls;
      const insertCall = allCalls[allCalls.length - 1];
      const insertValues = insertCall.slice(1).flat();
      // 2450/4900 = 0.5, floor(5000 * 0.5) = 2500
      expect(insertValues).toContain(-2500);
    });

    it('skips processing when refundedCents already covers the refund (idempotency)', async () => {
      // Purchase already has 4900 refundedCents (fully refunded before)
      const alreadyRefunded = { ...purchase, refundedCents: 4900 };
      configureSelectSequence([[alreadyRefunded]]);

      await reverseAddonTokens('user-1', 'ch_abc', 4900, 4900, 'pi_abc');

      // Should NOT have updated users or inserted transactions
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('processes only the new increment on a second partial refund', async () => {
      // First partial refund was 2450 cents (already tracked)
      const partiallyRefunded = { ...purchase, refundedCents: 2450 };
      configureSelectSequence([
        [partiallyRefunded],
        [{ addonTokens: 17500, monthlyTokens: 0, monthlyTokensUsed: 0, earnedCredits: 0 }],
      ]);

      // Stripe sends cumulative: 4900 total refunded (was 2450, now 4900)
      await reverseAddonTokens('user-1', 'ch_abc', 4900, 4900, 'pi_abc');

      expect(mockNeonTransaction).toHaveBeenCalledOnce();
      const allCalls = mockNeonSql.mock.calls;
      const insertCall = allCalls[allCalls.length - 1];
      const insertValues = insertCall.slice(1).flat();
      // New increment: 4900 - 2450 = 2450 cents
      // 2450/4900 (amountCents) * 5000 tokens = 2500
      expect(insertValues).toContain(-2500);
    });

    it('clamps deduction to user addon balance', async () => {
      // User only has 100 addon tokens left but purchase was 5000
      configureSelectSequence([
        [purchase],
        [{ addonTokens: 100, monthlyTokens: 0, monthlyTokensUsed: 0, earnedCredits: 0 }],
      ]);

      await reverseAddonTokens('user-1', 'ch_abc', 4900, 4900, 'pi_abc');

      expect(mockNeonTransaction).toHaveBeenCalledOnce();
      const allCalls = mockNeonSql.mock.calls;
      const insertCall = allCalls[allCalls.length - 1];
      const insertValues = insertCall.slice(1).flat();
      expect(insertValues).toContain(-100); // clamped to available balance
    });

    it('skips when user not found after purchase lookup', async () => {
      configureSelectSequence([
        [purchase],
        [], // user not found
      ]);

      await reverseAddonTokens('user-1', 'ch_abc', 4900, 4900, 'pi_abc');

      expect(mockNeonTransaction).not.toHaveBeenCalled();
    });

    it('skips when token deduction rounds to 0', async () => {
      // Tiny refund: 1 cent of 4900 -> ratio 0.000204, floor(5000 * 0.000204) = 1
      // Actually 1/4900 * 5000 = 1.02 -> floor = 1, so it should process
      // Use an even smaller case: purchase with 1 token
      const tinyPurchase = { ...purchase, tokens: 1 };
      configureSelectSequence([
        [tinyPurchase],
        // 1/4900 * 1 = 0.000204 -> floor = 0, should skip
      ]);

      await reverseAddonTokens('user-1', 'ch_abc', 1, 4900, 'pi_abc');

      // Should not proceed to user lookup since tokensToDeduct = 0
      expect(mockNeonTransaction).not.toHaveBeenCalled();
    });

    it('falls through to fallback when purchase not found', async () => {
      // tokenPurchases returns empty, fallback checks creditTransactions
      configureSelectSequence([
        [], // no purchase found
        [], // no existing refund transaction (idempotency check)
        [{ addonTokens: 1000, monthlyTokens: 0, monthlyTokensUsed: 0, earnedCredits: 0 }],
      ]);

      await reverseAddonTokens('user-1', 'ch_abc', 500, 1000, 'pi_abc');

      expect(mockNeonTransaction).toHaveBeenCalledOnce();
      const allCalls = mockNeonSql.mock.calls;
      const insertCall = allCalls[allCalls.length - 1];
      const insertValues = insertCall.slice(1).flat();
      // Fallback: 500/1000 * 1000 (user balance) = 500
      expect(insertValues).toContain(-500);
    });
  });

  describe('without paymentIntentId (fallback path)', () => {
    it('deducts proportionally from user balance', async () => {
      // No paymentIntentId, goes straight to fallback
      configureSelectSequence([
        [], // no existing refund (idempotency)
        [{ addonTokens: 1000, monthlyTokens: 0, monthlyTokensUsed: 0, earnedCredits: 0 }],
      ]);

      await reverseAddonTokens('user-1', 'ch_abc', 500, 1000);

      expect(mockNeonTransaction).toHaveBeenCalledOnce();
      const allCalls = mockNeonSql.mock.calls;
      const insertCall = allCalls[allCalls.length - 1];
      const insertValues = insertCall.slice(1).flat();
      expect(insertValues).toContain(-500);
    });

    it('skips when a refund transaction already exists (idempotency)', async () => {
      // Existing credit transaction found for this chargeId
      configureSelectSequence([
        [{ id: 'txn-existing' }], // existing refund found
      ]);

      await reverseAddonTokens('user-1', 'ch_abc', 500, 1000);

      expect(mockNeonTransaction).not.toHaveBeenCalled();
    });

    it('skips when user not found in fallback path', async () => {
      configureSelectSequence([
        [], // no existing refund
        [], // user not found
      ]);

      await reverseAddonTokens('user-1', 'ch_abc', 500, 1000);

      expect(mockNeonTransaction).not.toHaveBeenCalled();
    });

    it('skips when deduction rounds to 0 in fallback', async () => {
      configureSelectSequence([
        [], // no existing refund
        [{ addonTokens: 10, monthlyTokens: 0, monthlyTokensUsed: 0, earnedCredits: 0 }],
      ]);

      // 1/10000 * 10 = 0.001 -> floor = 0
      await reverseAddonTokens('user-1', 'ch_abc', 1, 10000);

      expect(mockNeonTransaction).not.toHaveBeenCalled();
    });

    it('clamps refund ratio to 1 when refund exceeds total', async () => {
      configureSelectSequence([
        [], // no existing refund
        [{ addonTokens: 1000, monthlyTokens: 0, monthlyTokensUsed: 0, earnedCredits: 0 }],
      ]);

      await reverseAddonTokens('user-1', 'ch_abc', 2000, 1000);

      expect(mockNeonTransaction).toHaveBeenCalledOnce();
      const allCalls = mockNeonSql.mock.calls;
      const insertCall = allCalls[allCalls.length - 1];
      const insertValues = insertCall.slice(1).flat();
      expect(insertValues).toContain(-1000);
    });
  });
});
