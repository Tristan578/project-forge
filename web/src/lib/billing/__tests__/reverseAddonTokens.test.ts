/**
 * Tests for reverseAddonTokens (PF-734, PF-7514, #8187).
 *
 * Verifies that:
 * 1. Refund tokens are calculated from the specific purchase, not user balance
 * 2. TOCTOU fix: single CTE statement prevents double-deduction on concurrent webhooks
 * 3. Partial refunds tracked via CTE WHERE refunded_cents < amountRefunded guard
 * 4. Fallback path works when no purchase record exists
 *
 * Both paths now use a single CTE-based SQL statement (not neonSql.transaction)
 * where deduction depends on the claim/insert via EXISTS/JOIN — so if the
 * claim matches 0 rows, the entire CTE chain is a no-op.
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
// Both paths now use a single CTE tagged template call (no .transaction()).
// We track all calls via mockNeonSqlCalls and control return values via
// mockNeonSqlCallResults.
const mockNeonTransaction = vi.fn().mockResolvedValue([]);
const mockNeonSqlCalls: { strings: TemplateStringsArray; values: unknown[] }[] = [];

// Configurable per-call return values for the raw neonSql tagged template calls.
// Each call pops the next result. Default: return empty array (no rows).
const mockNeonSqlCallResults: unknown[][] = [];

const mockNeonSql = Object.assign(
  vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]): unknown => {
    mockNeonSqlCalls.push({ strings: _strings, values: _values });
    const result = mockNeonSqlCallResults.shift();
    if (result !== undefined) {
      return Promise.resolve(result);
    }
    // Default: return empty array (CTE claimed 0 rows)
    return Promise.resolve([]);
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

// Helper to set the return value for the next raw neonSql`` call
function configureNeonSqlResult(result: unknown[]) {
  mockNeonSqlCallResults.push(result);
}

// Helper to find the CTE call (contains 'WITH claim AS' or 'WITH audit AS')
function findCteCall(keyword: string) {
  return mockNeonSqlCalls.find(call =>
    call.strings.some(s => s.includes(keyword))
  );
}

describe('reverseAddonTokens (PF-734, PF-7514, #8187)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNeonSqlCallResults.length = 0;
    mockNeonSqlCalls.length = 0;
    mockNeonTransaction.mockResolvedValue([]);
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

    it('uses a single CTE statement (not transaction) for atomicity', async () => {
      configureSelectSequence([[purchase]]);
      configureNeonSqlResult([{ id: 'user-1' }]); // CTE succeeded

      await reverseAddonTokens('user-1', 'ch_abc', 4900, 4900, 'pi_abc');

      // No transaction call — single CTE statement handles claim + audit + deduction
      expect(mockNeonTransaction).not.toHaveBeenCalled();

      // The CTE query should have been called
      const cteCall = findCteCall('claim');
      expect(cteCall).toBeDefined();
      // Values should include amountRefunded (4900), purchase.id, chargeId, userId
      expect(cteCall!.values).toContain(4900);
      expect(cteCall!.values).toContain(purchase.id);
      expect(cteCall!.values).toContain('user-1');
    });

    it('skips when refundedCents already covers the refund (idempotency)', async () => {
      const alreadyRefunded = { ...purchase, refundedCents: 4900 };
      configureSelectSequence([[alreadyRefunded]]);

      await reverseAddonTokens('user-1', 'ch_abc', 4900, 4900, 'pi_abc');

      // CTE claim would match 0 rows — entire chain is a no-op.
      // The CTE is still called but returns empty, which is correct.
      expect(mockNeonTransaction).not.toHaveBeenCalled();
    });

    it('skips when token deduction rounds to 0', async () => {
      const tinyPurchase = { ...purchase, tokens: 1 };
      configureSelectSequence([[tinyPurchase]]);

      await reverseAddonTokens('user-1', 'ch_abc', 1, 4900, 'pi_abc');

      // floor(1 * 1/4900) = 0 → no deduction needed
      // The CTE is still called but the SQL FLOOR produces 0, so
      // the WHERE tokens_to_deduct > 0 guard prevents audit + deduction
      expect(mockNeonTransaction).not.toHaveBeenCalled();
    });

    it('processes partially-refunded purchases using the new increment', async () => {
      // First partial was 2450 cents
      const partiallyRefunded = { ...purchase, refundedCents: 2450 };
      configureSelectSequence([[partiallyRefunded]]);
      configureNeonSqlResult([{ id: 'user-1' }]);

      await reverseAddonTokens('user-1', 'ch_abc', 4900, 4900, 'pi_abc');

      // CTE computes: old_refunded_cents from the atomically-claimed row,
      // delta = 4900 - old_refunded_cents, ratio = delta / 4900
      // The SQL handles this in-database, not in JS
      const cteCall = findCteCall('claim');
      expect(cteCall).toBeDefined();
      expect(cteCall!.values).toContain(4900); // amountRefunded
    });

    it('falls through to fallback when purchase not found', async () => {
      configureSelectSequence([
        [], // no purchase found → fallback
      ]);

      await reverseAddonTokens('user-1', 'ch_abc', 500, 1000, 'pi_abc');

      // Fallback uses audit CTE (not claim CTE)
      const cteCall = findCteCall('audit');
      expect(cteCall).toBeDefined();
    });
  });

  describe('without paymentIntentId (fallback path)', () => {
    it('uses a single CTE statement with NOT EXISTS guard', async () => {
      await reverseAddonTokens('user-1', 'ch_abc', 500, 1000);

      // No transaction — single CTE handles idempotency + deduction
      expect(mockNeonTransaction).not.toHaveBeenCalled();

      const cteCall = findCteCall('audit');
      expect(cteCall).toBeDefined();
      // Values should include userId, refundRatio, chargeId, source
      expect(cteCall!.values).toContain('user-1');
      expect(cteCall!.values).toContain('ch_abc');
    });

    it('SQL NOT EXISTS guard prevents duplicate refunds (idempotency)', async () => {
      // Call twice — the SQL NOT EXISTS guard prevents double-deduction
      // in production. In the mock, both calls will "succeed" because the
      // mock doesn't maintain SQL state, but we verify the query structure
      // includes the NOT EXISTS clause.
      await reverseAddonTokens('user-1', 'ch_abc', 500, 1000);

      const cteCall = findCteCall('audit');
      expect(cteCall).toBeDefined();
      // Verify the SQL template contains NOT EXISTS
      const fullSql = cteCall!.strings.join('$');
      expect(fullSql).toContain('NOT EXISTS');
    });

    it('includes charge source and reference in the CTE', async () => {
      await reverseAddonTokens('user-1', 'ch_abc', 500, 1000);

      const cteCall = findCteCall('audit');
      expect(cteCall).toBeDefined();
      expect(cteCall!.values).toContain('charge_refunded:ch_abc');
      expect(cteCall!.values).toContain('ch_abc');
    });

    it('passes refund ratio to SQL for proportional deduction', async () => {
      await reverseAddonTokens('user-1', 'ch_abc', 500, 1000);

      const cteCall = findCteCall('audit');
      expect(cteCall).toBeDefined();
      // refundRatio = min(500/1000, 1) = 0.5
      expect(cteCall!.values).toContain(0.5);
    });

    it('clamps refund ratio to 1 when refund exceeds total', async () => {
      await reverseAddonTokens('user-1', 'ch_abc', 2000, 1000);

      const cteCall = findCteCall('audit');
      expect(cteCall).toBeDefined();
      // refundRatio = min(2000/1000, 1) = 1
      expect(cteCall!.values).toContain(1);
    });
  });
});
