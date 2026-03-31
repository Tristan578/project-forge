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
      configureSelectSequence([[purchase]]);

      await reverseAddonTokens('user-1', 'ch_abc', 4900, 4900, 'pi_abc');

      // All operations in a single transaction: claim + audit + deduction
      expect(mockNeonTransaction).toHaveBeenCalledOnce();
      const txStatements = mockNeonTransaction.mock.calls[0][0] as MockStatement[];
      // 3 statements: claim UPDATE, audit INSERT, user UPDATE
      expect(txStatements).toHaveLength(3);
      // Claim: UPDATE token_purchases SET refunded_cents = 4900
      expect(txStatements[0].values).toContain(4900);
      expect(txStatements[0].values).toContain(purchase.id);
      // Audit INSERT: deduction amount = floor(5000 * 4900/4900) = 5000
      expect(txStatements[1].values).toContain(5000);
      expect(txStatements[1].values).toContain('charge_refunded:ch_abc');
    });

    it('handles 50% partial refund correctly', async () => {
      configureSelectSequence([[purchase]]);

      await reverseAddonTokens('user-1', 'ch_abc', 2450, 4900, 'pi_abc');

      expect(mockNeonTransaction).toHaveBeenCalledOnce();
      const txStatements = mockNeonTransaction.mock.calls[0][0] as MockStatement[];
      // floor(5000 * 2450/4900) = 2500
      expect(txStatements[1].values).toContain(2500);
    });

    it('skips when refundedCents already covers the refund (idempotency)', async () => {
      // Purchase already fully refunded
      const alreadyRefunded = { ...purchase, refundedCents: 4900 };
      configureSelectSequence([[alreadyRefunded]]);

      await reverseAddonTokens('user-1', 'ch_abc', 4900, 4900, 'pi_abc');

      // JS-side idempotency check: newRefundCents = 4900 - 4900 = 0 → skip
      expect(mockNeonTransaction).not.toHaveBeenCalled();
    });

    it('processes only the new increment on a second partial refund', async () => {
      // First partial was 2450 cents (tracked in refundedCents)
      const partiallyRefunded = { ...purchase, refundedCents: 2450 };
      configureSelectSequence([[partiallyRefunded]]);

      await reverseAddonTokens('user-1', 'ch_abc', 4900, 4900, 'pi_abc');

      expect(mockNeonTransaction).toHaveBeenCalledOnce();
      const txStatements = mockNeonTransaction.mock.calls[0][0] as MockStatement[];
      // New increment: 4900 - 2450 = 2450 cents → floor(5000 * 2450/4900) = 2500
      expect(txStatements[1].values).toContain(2500);
    });

    it('skips when token deduction rounds to 0', async () => {
      const tinyPurchase = { ...purchase, tokens: 1 };
      configureSelectSequence([[tinyPurchase]]);

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
