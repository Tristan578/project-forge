/**
 * Tests for reverseAddonTokens (PF-734, PF-7514).
 *
 * Verifies that:
 * 1. Refund tokens are calculated from the specific purchase, not user balance
 * 2. TOCTOU fix: atomic CTE claim prevents double-deduction on concurrent webhooks
 * 3. Partial refunds tracked via CTE WHERE refunded_cents < amountRefunded guard
 * 4. Fallback path works when no purchase record exists
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// --- Mock chain builders ---

const mockSelectLimit = vi.fn().mockResolvedValue([]);
const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockDb = { select: mockSelect };

// Neon SQL mock.
// The purchase-based path uses a raw neonSql CTE tagged template for the atomic claim,
// then neonSql.transaction() for the deduction. We control per-call return values via
// mockNeonSqlCallResults.
interface MockStatement { _type: 'neon_statement'; values: unknown[] }
const mockNeonTransaction = vi.fn().mockResolvedValue([]);

// Configurable per-call return values for the raw neonSql tagged template calls.
// Each call pops the next result. Default: return empty array (no rows claimed).
const mockNeonSqlCallResults: unknown[][] = [];

const mockNeonSql = Object.assign(
  vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]): unknown => {
    const result = mockNeonSqlCallResults.shift();
    if (result !== undefined) {
      // Return a Promise so await works for the claim query
      return Promise.resolve(result);
    }
    // Default: return a mock statement object (used when result is passed to .transaction())
    return { _type: 'neon_statement', values: _values } as MockStatement;
  }),
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

// Helper to configure the drizzle select mock return sequence
function configureSelectSequence(responses: unknown[][]) {
  for (const response of responses) {
    mockSelectLimit.mockResolvedValueOnce(response);
  }
}

// Helper to set the return value for the next raw neonSql`` call (the CTE claim query)
function configureNeonSqlClaim(result: unknown[]) {
  mockNeonSqlCallResults.push(result);
}

describe('reverseAddonTokens (PF-734, PF-7514)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNeonSqlCallResults.length = 0;
    mockNeonTransaction.mockResolvedValue([]);
  });

  describe('with paymentIntentId (purchase-based path, PF-7514 CTE claim)', () => {
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

    it('deducts tokens based on purchase token count (full refund)', async () => {
      // tokenPurchases lookup -> finds purchase
      configureSelectSequence([[purchase]]);
      // CTE claim: UPDATE returns the row with computed increment
      // increment_cents = 4900 - 0 (old refunded_cents) = 4900
      configureNeonSqlClaim([{ tokens: 5000, amount_cents: 4900, increment_cents: 4900 }]);

      await reverseAddonTokens('user-1', 'ch_abc', 4900, 4900, 'pi_abc');

      // Token deduction written via neonSql.transaction()
      expect(mockNeonTransaction).toHaveBeenCalledOnce();
      // The INSERT uses -LEAST(${deduction}, addon_tokens) in SQL — the JS
      // interpolated value is the positive deduction amount (negation is in SQL).
      const txStatements = mockNeonTransaction.mock.calls[0][0] as MockStatement[];
      const insertStmt = txStatements[0];
      expect(insertStmt.values).toContain(5000);
      expect(insertStmt.values).toContain('charge_refunded:ch_abc');
    });

    it('handles 50% partial refund correctly', async () => {
      configureSelectSequence([[purchase]]);
      // increment_cents = 2450 - 0 = 2450
      configureNeonSqlClaim([{ tokens: 5000, amount_cents: 4900, increment_cents: 2450 }]);

      await reverseAddonTokens('user-1', 'ch_abc', 2450, 4900, 'pi_abc');

      expect(mockNeonTransaction).toHaveBeenCalledOnce();
      const txStatements = mockNeonTransaction.mock.calls[0][0] as MockStatement[];
      const insertStmt = txStatements[0];
      // floor(5000 * 2450/4900) = floor(2500) = 2500 (positive — negation in SQL)
      expect(insertStmt.values).toContain(2500);
    });

    it('skips processing when CTE claim returns 0 rows (idempotency / concurrent webhook)', async () => {
      // Simulates the case where another concurrent request already advanced
      // refunded_cents to amountRefunded, so WHERE refunded_cents < amountRefunded
      // matches nothing and RETURNING is empty.
      configureSelectSequence([[purchase]]);
      configureNeonSqlClaim([]); // 0 rows = claim failed

      await reverseAddonTokens('user-1', 'ch_abc', 4900, 4900, 'pi_abc');

      // No token deduction should happen
      expect(mockNeonTransaction).not.toHaveBeenCalled();
    });

    it('processes only the new increment on a second partial refund', async () => {
      // First partial refund was 2450 cents (already tracked).
      // Stripe now sends cumulative 4900. The CTE captures increment = 2450.
      const partiallyRefunded = { ...purchase, refundedCents: 2450 };
      configureSelectSequence([[partiallyRefunded]]);
      configureNeonSqlClaim([{ tokens: 5000, amount_cents: 4900, increment_cents: 2450 }]);

      await reverseAddonTokens('user-1', 'ch_abc', 4900, 4900, 'pi_abc');

      expect(mockNeonTransaction).toHaveBeenCalledOnce();
      const txStatements = mockNeonTransaction.mock.calls[0][0] as MockStatement[];
      const insertStmt = txStatements[0];
      // New increment: 2450 cents / 4900 total cents * 5000 tokens = 2500 (positive — negation in SQL)
      expect(insertStmt.values).toContain(2500);
    });

    it('skips when token deduction rounds to 0', async () => {
      // 1 token purchase, 1-cent refund of 4900: floor(1 * 1/4900) = 0
      const tinyPurchase = { ...purchase, tokens: 1 };
      configureSelectSequence([[tinyPurchase]]);
      configureNeonSqlClaim([{ tokens: 1, amount_cents: 4900, increment_cents: 1 }]);

      await reverseAddonTokens('user-1', 'ch_abc', 1, 4900, 'pi_abc');

      expect(mockNeonTransaction).not.toHaveBeenCalled();
    });

    it('falls through to fallback when purchase not found', async () => {
      // tokenPurchases returns empty -> fallback path
      configureSelectSequence([
        [], // no purchase found
        [], // no existing refund transaction (idempotency check)
        [{ addonTokens: 1000, monthlyTokens: 0, monthlyTokensUsed: 0, earnedCredits: 0 }],
      ]);

      await reverseAddonTokens('user-1', 'ch_abc', 500, 1000, 'pi_abc');

      expect(mockNeonTransaction).toHaveBeenCalledOnce();
      const txStatements = mockNeonTransaction.mock.calls[0][0] as MockStatement[];
      const insertStmt = txStatements[0];
      // Fallback: 500/1000 * 1000 (user balance) = 500
      expect(insertStmt.values).toContain(-500);
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
      const txStatements = mockNeonTransaction.mock.calls[0][0] as MockStatement[];
      const insertStmt = txStatements[0];
      expect(insertStmt.values).toContain(-500);
    });

    it('skips when a refund transaction already exists (idempotency)', async () => {
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
      const txStatements = mockNeonTransaction.mock.calls[0][0] as MockStatement[];
      const insertStmt = txStatements[0];
      expect(insertStmt.values).toContain(-1000);
    });
  });
});
