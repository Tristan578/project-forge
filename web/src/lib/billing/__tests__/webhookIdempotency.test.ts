/**
 * Tests for the DB-backed webhook idempotency service.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Required mocks BEFORE module import
vi.mock('server-only', () => ({}));

// We'll capture the mock insert/delete/select/update chains.
// The implementation uses .returning() which must be in the chain.
const mockSelectRows: { eventId: string }[] = [];

// Insert chain: insert().values().onConflictDoNothing().returning()
const mockInsertReturning = vi.fn().mockResolvedValue([{ eventId: 'evt_new' }]);
const mockOnConflictDoNothing = vi.fn().mockReturnValue({ returning: mockInsertReturning });
const mockInsertValues = vi.fn().mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

// Delete chain: delete().where().returning() (for cleanupExpired) or delete().where() (for releaseEvent)
const mockDeleteReturning = vi.fn().mockResolvedValue([]);
const mockDeleteWhere = vi.fn().mockReturnValue({ returning: mockDeleteReturning });
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

// Select chain: select().from().where().limit()
const mockSelectLimit = vi.fn().mockResolvedValue(mockSelectRows);
const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

// Update chain: update().set().where()
const mockUpdateWhere = vi.fn().mockResolvedValue({ rowCount: 1 });
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

const mockDb = {
  insert: mockInsert,
  delete: mockDelete,
  select: mockSelect,
  update: mockUpdate,
};

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => mockDb),
  // Pass-through: queryWithResilience just calls the operation directly in tests
  queryWithResilience: vi.fn(<T>(op: () => Promise<T>) => op()),
}));

// Import AFTER mocks are set up
import { claimEvent, releaseEvent, isProcessed, cleanupExpired, finalizeEvent } from '../webhookIdempotency';

describe('webhookIdempotency', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-03-27T00:00:00Z') });
    vi.clearAllMocks();
    // Reset mock return values to defaults
    mockInsertReturning.mockResolvedValue([{ eventId: 'evt_default' }]);
    mockOnConflictDoNothing.mockReturnValue({ returning: mockInsertReturning });
    mockDeleteReturning.mockResolvedValue([]);
    mockDeleteWhere.mockReturnValue({ returning: mockDeleteReturning });
    mockSelectLimit.mockResolvedValue([]);
    mockUpdateWhere.mockResolvedValue({ rowCount: 1 });
  });

  // ----------------------------------------------------------------
  // claimEvent
  // ----------------------------------------------------------------
  describe('claimEvent', () => {
    it('returns true when the event is new (returning has rows)', async () => {
      mockInsertReturning.mockResolvedValueOnce([{ eventId: 'evt_new' }]);

      const result = await claimEvent('evt_new', 'stripe');

      expect(result).toBe(true);
      expect(mockInsert).toHaveBeenCalled();
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt_new', source: 'stripe' })
      );
    });

    it('returns false when the event is a duplicate (returning is empty)', async () => {
      mockInsertReturning.mockResolvedValueOnce([]);

      const result = await claimEvent('evt_dup', 'stripe');

      expect(result).toBe(false);
    });

    it('uses a short in-flight TTL of 5 minutes', async () => {
      mockInsertReturning.mockResolvedValueOnce([{ eventId: 'evt_ttl' }]);

      await claimEvent('evt_ttl', 'stripe');

      const insertedValues = mockInsertValues.mock.calls[0][0] as { expiresAt: Date };

      // With fake timers pinned to 2026-03-27T00:00:00Z, the TTL should be exactly 5 min later
      const expectedMs = new Date('2026-03-27T00:05:00Z').getTime();
      expect(insertedValues.expiresAt.getTime()).toBe(expectedMs);
    });
  });

  // ----------------------------------------------------------------
  // finalizeEvent
  // ----------------------------------------------------------------
  describe('finalizeEvent', () => {
    it('extends the TTL to 72 hours by default', async () => {
      await finalizeEvent('evt_finalize');

      const setArg = mockUpdateSet.mock.calls[0][0] as { expiresAt: Date };

      // Fake time is 2026-03-27T00:00:00Z + 72 hours
      const expectedMs = new Date('2026-03-30T00:00:00Z').getTime();
      expect(setArg.expiresAt.getTime()).toBe(expectedMs);
    });

    it('accepts a custom TTL', async () => {
      await finalizeEvent('evt_custom', 24);

      const setArg = mockUpdateSet.mock.calls[0][0] as { expiresAt: Date };

      // Fake time + 24 hours
      const expectedMs = new Date('2026-03-28T00:00:00Z').getTime();
      expect(setArg.expiresAt.getTime()).toBe(expectedMs);
    });
  });

  // ----------------------------------------------------------------
  // releaseEvent
  // ----------------------------------------------------------------
  describe('releaseEvent', () => {
    it('deletes the event row from the database', async () => {
      await releaseEvent('evt_release', 'stripe');

      expect(mockDelete).toHaveBeenCalled();
      expect(mockDeleteWhere).toHaveBeenCalled();
    });

    it('does not throw when delete finds no matching row (rowCount = 0)', async () => {
      mockDeleteWhere.mockResolvedValueOnce({ rowCount: 0 });

      await expect(releaseEvent('evt_not_found', 'stripe')).resolves.toBeUndefined();
    });
  });

  // ----------------------------------------------------------------
  // isProcessed
  // ----------------------------------------------------------------
  describe('isProcessed', () => {
    it('returns false when no row exists for the event', async () => {
      mockSelectLimit.mockResolvedValueOnce([]);

      const result = await isProcessed('evt_unknown', 'stripe');

      expect(result).toBe(false);
    });

    it('returns true when a non-expired row exists', async () => {
      mockSelectLimit.mockResolvedValueOnce([{ eventId: 'evt_known' }]);

      const result = await isProcessed('evt_known', 'stripe');

      expect(result).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // TTL safety net: expired events are re-claimable
  // ----------------------------------------------------------------
  describe('TTL expiry and re-claim', () => {
    it('allows re-claiming an event after its row is deleted (simulating TTL expiry)', async () => {
      // First delivery: INSERT succeeds, claim granted
      mockInsertReturning.mockResolvedValueOnce([{ eventId: 'evt_expired' }]);
      const firstClaim = await claimEvent('evt_expired', 'stripe');
      expect(firstClaim).toBe(true);

      // Simulate TTL expiry: cleanupExpired deletes the row
      mockDeleteReturning.mockResolvedValueOnce([{ eventId: 'evt_expired' }]);
      const deletedCount = await cleanupExpired();
      expect(deletedCount).toBe(1);

      // Second delivery (Stripe retry after expiry): INSERT succeeds again
      // because the row was deleted by cleanupExpired
      mockInsertReturning.mockResolvedValueOnce([{ eventId: 'evt_expired' }]);
      const secondClaim = await claimEvent('evt_expired', 'stripe');
      expect(secondClaim).toBe(true);
    });

    it('rejects duplicate claim before TTL expires', async () => {
      // First delivery succeeds
      mockInsertReturning.mockResolvedValueOnce([{ eventId: 'evt_inflight' }]);
      const firstClaim = await claimEvent('evt_inflight', 'stripe');
      expect(firstClaim).toBe(true);

      // Second delivery while row still exists: ON CONFLICT DO NOTHING returns empty
      mockInsertReturning.mockResolvedValueOnce([]);
      const secondClaim = await claimEvent('evt_inflight', 'stripe');
      expect(secondClaim).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // cleanupExpired
  // ----------------------------------------------------------------
  describe('cleanupExpired', () => {
    it('deletes expired rows and returns the count', async () => {
      mockDeleteReturning.mockResolvedValueOnce([
        { eventId: 'e1' }, { eventId: 'e2' }, { eventId: 'e3' },
        { eventId: 'e4' }, { eventId: 'e5' },
      ]);

      const count = await cleanupExpired();

      expect(count).toBe(5);
      expect(mockDelete).toHaveBeenCalled();
      expect(mockDeleteWhere).toHaveBeenCalled();
    });

    it('returns 0 when no expired rows exist', async () => {
      mockDeleteReturning.mockResolvedValueOnce([]);

      const count = await cleanupExpired();

      expect(count).toBe(0);
    });
  });
});
