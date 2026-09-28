/**
 * Tests for the provider-job ownership binding (#10262).
 */

vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

// Insert chain: insert().values().onConflictDoNothing()
const mockOnConflictDoNothing = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockInsertValues = vi.hoisted(() => vi.fn(() => ({ onConflictDoNothing: mockOnConflictDoNothing })));
const mockInsert = vi.hoisted(() => vi.fn(() => ({ values: mockInsertValues })));

// Select chain: select().from().where().limit()
const mockSelectLimit = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockSelectWhere = vi.hoisted(() => vi.fn(() => ({ limit: mockSelectLimit })));
const mockSelectFrom = vi.hoisted(() => vi.fn(() => ({ where: mockSelectWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockSelectFrom })));

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => ({ insert: mockInsert, select: mockSelect })),
  // Pass-through: queryWithResilience just calls the operation directly in tests.
  queryWithResilience: vi.fn(<T>(op: () => Promise<T>) => op()),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));

// Imported AFTER mocks are set up.
import {
  bindProviderJob,
  verifyProviderJobOwner,
  findProviderJobOwnerId,
} from '../jobOwnership';
import { captureException } from '@/lib/monitoring/sentry-server';

const mockCaptureException = vi.mocked(captureException);

describe('jobOwnership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnConflictDoNothing.mockResolvedValue(undefined);
    mockInsertValues.mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
    mockInsert.mockReturnValue({ values: mockInsertValues });
    mockSelectLimit.mockResolvedValue([]);
    mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
    mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
    mockSelect.mockReturnValue({ from: mockSelectFrom });
  });

  // -------------------------------------------------------------------
  // bindProviderJob
  // -------------------------------------------------------------------
  describe('bindProviderJob', () => {
    it('inserts the (provider, providerJobId) -> userId binding', async () => {
      await bindProviderJob('user-1', 'meshy', 'task-abc');

      expect(mockInsert).toHaveBeenCalled();
      expect(mockInsertValues).toHaveBeenCalledWith({
        userId: 'user-1',
        provider: 'meshy',
        providerJobId: 'task-abc',
      });
    });

    it('uses ON CONFLICT DO NOTHING so first writer wins and a job can never be reassigned', async () => {
      await bindProviderJob('user-1', 'meshy', 'task-abc');

      expect(mockOnConflictDoNothing).toHaveBeenCalledTimes(1);
    });

    it('never throws when the write fails, and reports it to Sentry instead', async () => {
      mockOnConflictDoNothing.mockRejectedValueOnce(new Error('db down'));

      await expect(bindProviderJob('user-1', 'meshy', 'task-abc')).resolves.toBeUndefined();
      expect(mockCaptureException).toHaveBeenCalledTimes(1);
      expect(mockCaptureException.mock.calls[0][1]).toMatchObject({
        action: 'bind_provider_job',
        provider: 'meshy',
        providerJobId: 'task-abc',
        userId: 'user-1',
      });
    });
  });

  // -------------------------------------------------------------------
  // verifyProviderJobOwner
  // -------------------------------------------------------------------
  describe('verifyProviderJobOwner', () => {
    it('returns true when a binding exists for this exact user', async () => {
      mockSelectLimit.mockResolvedValueOnce([{ userId: 'user-1' }]);

      const result = await verifyProviderJobOwner('user-1', 'meshy', 'task-abc');

      expect(result).toBe(true);
    });

    it('returns false when the binding belongs to a DIFFERENT user', async () => {
      mockSelectLimit.mockResolvedValueOnce([{ userId: 'someone-else' }]);

      const result = await verifyProviderJobOwner('user-1', 'meshy', 'task-abc');

      expect(result).toBe(false);
    });

    it('returns false when no binding exists at all (unbound / legacy job)', async () => {
      mockSelectLimit.mockResolvedValueOnce([]);

      const result = await verifyProviderJobOwner('user-1', 'meshy', 'task-abc');

      expect(result).toBe(false);
    });

    it('fails CLOSED (returns false) and reports to Sentry when the lookup itself throws', async () => {
      mockSelectLimit.mockRejectedValueOnce(new Error('db down'));

      const result = await verifyProviderJobOwner('user-1', 'meshy', 'task-abc');

      expect(result).toBe(false);
      expect(mockCaptureException).toHaveBeenCalledTimes(1);
      expect(mockCaptureException.mock.calls[0][1]).toMatchObject({
        action: 'verify_provider_job_owner',
        provider: 'meshy',
        providerJobId: 'task-abc',
        userId: 'user-1',
      });
    });

    it('scopes the lookup to the given provider and providerJobId', async () => {
      mockSelectLimit.mockResolvedValueOnce([{ userId: 'user-1' }]);

      await verifyProviderJobOwner('user-1', 'replicate', 'pred-123');

      // Render the real drizzle predicate handed to `.where()` (the schema is
      // not mocked here) and assert BOTH columns with BOTH values. The prior
      // form asserted only that select/from/where/limit were called, which a
      // lookup missing either predicate — or keyed on the wrong column — would
      // satisfy just as well (lessons-learned #11).
      expect(mockSelectWhere).toHaveBeenCalledTimes(1);
      const predicate = (mockSelectWhere.mock.calls[0] as unknown[])[0] as SQL;
      const { sql, params } = new PgDialect().sqlToQuery(predicate);
      expect(sql).toContain('"provider_job_owners"."provider" = $1');
      expect(sql).toContain('"provider_job_owners"."provider_job_id" = $2');
      expect(params).toEqual(['replicate', 'pred-123']);
      expect(mockSelectLimit).toHaveBeenCalledWith(1);
    });
  });

  // -------------------------------------------------------------------
  // findProviderJobOwnerId
  // -------------------------------------------------------------------
  describe('findProviderJobOwnerId', () => {
    it('returns the owning userId when a binding exists', async () => {
      mockSelectLimit.mockResolvedValueOnce([{ userId: 'user-1' }]);

      const result = await findProviderJobOwnerId('meshy', 'task-abc');

      expect(result).toBe('user-1');
    });

    it('returns null when no binding exists', async () => {
      mockSelectLimit.mockResolvedValueOnce([]);

      const result = await findProviderJobOwnerId('meshy', 'task-abc');

      expect(result).toBeNull();
    });

    it('propagates a lookup failure rather than silently treating it as unbound', async () => {
      mockSelectLimit.mockRejectedValueOnce(new Error('db down'));

      await expect(findProviderJobOwnerId('meshy', 'task-abc')).rejects.toThrow('db down');
    });
  });
});
