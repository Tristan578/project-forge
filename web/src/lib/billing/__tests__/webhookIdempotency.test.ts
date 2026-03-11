/**
 * Tests for the DB-backed webhook idempotency service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Required mocks BEFORE module import
vi.mock('server-only', () => ({}));

// We'll capture the mock insert/delete/select/update chains
const mockInsertReturn = { rowCount: 1 };
const mockDeleteReturn = { rowCount: 1 };
const mockSelectRows: { eventId: string }[] = [];

const mockOnConflictDoNothing = vi.fn().mockResolvedValue(mockInsertReturn);
const mockInsertValues = vi.fn().mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockDeleteWhere = vi.fn().mockResolvedValue(mockDeleteReturn);
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

const mockSelectLimit = vi.fn().mockResolvedValue(mockSelectRows);
const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

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
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock return values to defaults
    mockOnConflictDoNothing.mockResolvedValue({ rowCount: 1 });
    mockDeleteWhere.mockResolvedValue({ rowCount: 1 });
    mockSelectLimit.mockResolvedValue([]);
    mockUpdateWhere.mockResolvedValue({ rowCount: 1 });
  });

  // ----------------------------------------------------------------
  // claimEvent
  // ----------------------------------------------------------------
  describe('claimEvent', () => {
    it('returns true when the event is new (rowCount = 1)', async () => {
      mockOnConflictDoNothing.mockResolvedValueOnce({ rowCount: 1 });

      const result = await claimEvent('evt_new', 'stripe');

      expect(result).toBe(true);
      expect(mockInsert).toHaveBeenCalled();
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt_new', source: 'stripe' })
      );
    });

    it('returns false when the event is a duplicate (rowCount = 0)', async () => {
      mockOnConflictDoNothing.mockResolvedValueOnce({ rowCount: 0 });

      const result = await claimEvent('evt_dup', 'stripe');

      expect(result).toBe(false);
    });

    it('uses a short in-flight TTL of 5 minutes', async () => {
      const before = Date.now();
      mockOnConflictDoNothing.mockResolvedValueOnce({ rowCount: 1 });

      await claimEvent('evt_ttl', 'stripe');

      const insertedValues = mockInsertValues.mock.calls[0][0] as { expiresAt: Date };
      const after = Date.now();

      // 5 minutes in-flight TTL
      const expectedMinMs = before + 5 * 60 * 1000;
      const expectedMaxMs = after + 5 * 60 * 1000;

      expect(insertedValues.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMinMs);
      expect(insertedValues.expiresAt.getTime()).toBeLessThanOrEqual(expectedMaxMs);
    });

    it('handles undefined rowCount gracefully (treats as 0)', async () => {
      mockOnConflictDoNothing.mockResolvedValueOnce({});

      const result = await claimEvent('evt_no_rowcount', 'stripe');

      expect(result).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // finalizeEvent
  // ----------------------------------------------------------------
  describe('finalizeEvent', () => {
    it('extends the TTL to 72 hours by default', async () => {
      const before = Date.now();

      await finalizeEvent('evt_finalize');

      const setArg = mockUpdateSet.mock.calls[0][0] as { expiresAt: Date };
      const after = Date.now();

      const expectedMinMs = before + 72 * 60 * 60 * 1000;
      const expectedMaxMs = after + 72 * 60 * 60 * 1000;

      expect(setArg.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMinMs);
      expect(setArg.expiresAt.getTime()).toBeLessThanOrEqual(expectedMaxMs);
    });

    it('accepts a custom TTL', async () => {
      const before = Date.now();

      await finalizeEvent('evt_custom', 24);

      const setArg = mockUpdateSet.mock.calls[0][0] as { expiresAt: Date };
      const after = Date.now();

      const expectedMinMs = before + 24 * 60 * 60 * 1000;
      const expectedMaxMs = after + 24 * 60 * 60 * 1000;

      expect(setArg.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMinMs);
      expect(setArg.expiresAt.getTime()).toBeLessThanOrEqual(expectedMaxMs);
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
  // cleanupExpired
  // ----------------------------------------------------------------
  describe('cleanupExpired', () => {
    it('deletes expired rows and returns the count', async () => {
      mockDeleteWhere.mockResolvedValueOnce({ rowCount: 5 });

      const count = await cleanupExpired();

      expect(count).toBe(5);
      expect(mockDelete).toHaveBeenCalled();
      expect(mockDeleteWhere).toHaveBeenCalled();
    });

    it('returns 0 when no expired rows exist', async () => {
      mockDeleteWhere.mockResolvedValueOnce({ rowCount: 0 });

      const count = await cleanupExpired();

      expect(count).toBe(0);
    });

    it('handles undefined rowCount gracefully', async () => {
      mockDeleteWhere.mockResolvedValueOnce({});

      const count = await cleanupExpired();

      expect(count).toBe(0);
    });
  });
});
