/**
 * Tests for the DB-backed webhook idempotency service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Required mocks BEFORE module import
vi.mock('server-only', () => ({}));

// We'll capture the mock insert/delete/select chains
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

const mockDb = {
  insert: mockInsert,
  delete: mockDelete,
  select: mockSelect,
};

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => mockDb),
}));

// Import AFTER mocks are set up
import { claimEvent, releaseEvent, isProcessed, cleanupExpired } from '../webhookIdempotency';

describe('webhookIdempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock return values to defaults
    mockOnConflictDoNothing.mockResolvedValue({ rowCount: 1 });
    mockDeleteWhere.mockResolvedValue({ rowCount: 1 });
    mockSelectLimit.mockResolvedValue([]);
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

    it('uses the default TTL of 72 hours', async () => {
      const before = Date.now();
      mockOnConflictDoNothing.mockResolvedValueOnce({ rowCount: 1 });

      await claimEvent('evt_ttl', 'stripe');

      const insertedValues = mockInsertValues.mock.calls[0][0] as { expiresAt: Date };
      const after = Date.now();

      const expectedMinMs = before + 72 * 60 * 60 * 1000;
      const expectedMaxMs = after + 72 * 60 * 60 * 1000;

      expect(insertedValues.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMinMs);
      expect(insertedValues.expiresAt.getTime()).toBeLessThanOrEqual(expectedMaxMs);
    });

    it('accepts a custom TTL', async () => {
      const before = Date.now();
      mockOnConflictDoNothing.mockResolvedValueOnce({ rowCount: 1 });

      await claimEvent('evt_custom_ttl', 'clerk', 24);

      const insertedValues = mockInsertValues.mock.calls[0][0] as { expiresAt: Date };
      const after = Date.now();

      const expectedMinMs = before + 24 * 60 * 60 * 1000;
      const expectedMaxMs = after + 24 * 60 * 60 * 1000;

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
