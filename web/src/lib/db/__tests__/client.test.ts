import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockNeon = vi.fn().mockReturnValue('mock-sql-fn');
const mockDrizzle = vi.fn().mockReturnValue({ select: vi.fn(), insert: vi.fn() });

vi.mock('@neondatabase/serverless', () => ({
  neon: mockNeon,
}));

vi.mock('drizzle-orm/neon-http', () => ({
  drizzle: mockDrizzle,
}));

const mockExecute = vi.fn();
vi.mock('@/lib/db/circuitBreaker', () => ({
  dbCircuitBreaker: {
    execute: mockExecute,
  },
}));

const mockWithRetry = vi.fn();
vi.mock('@/lib/db/withRetry', () => ({
  withRetry: mockWithRetry,
}));

describe('db/client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('getDb', () => {
    it('creates a drizzle instance with DATABASE_URL', async () => {
      process.env.DATABASE_URL = 'postgres://test:test@localhost/testdb';
      const { getDb } = await import('../client');
      const db = getDb();
      expect(mockNeon).toHaveBeenCalledWith('postgres://test:test@localhost/testdb');
      expect(mockDrizzle).toHaveBeenCalled();
      expect(db).not.toBeUndefined();
      delete process.env.DATABASE_URL;
    });

    it('throws when DATABASE_URL is not set', async () => {
      const savedUrl = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;
      const { getDb } = await import('../client');
      expect(() => getDb()).toThrow('DATABASE_URL environment variable is not set');
      if (savedUrl) process.env.DATABASE_URL = savedUrl;
    });

    it('returns the same singleton on subsequent calls', async () => {
      process.env.DATABASE_URL = 'postgres://test:test@localhost/testdb';
      const { getDb } = await import('../client');
      const db1 = getDb();
      const db2 = getDb();
      expect(db1).toBe(db2);
      expect(mockNeon).toHaveBeenCalledTimes(1);
      delete process.env.DATABASE_URL;
    });
  });

  describe('queryWithResilience', () => {
    it('wraps operation with circuit breaker and retry', async () => {
      process.env.DATABASE_URL = 'postgres://test:test@localhost/testdb';
      const operation = vi.fn().mockResolvedValue('query-result');

      mockExecute.mockImplementation(async (fn: () => Promise<unknown>) => fn());
      mockWithRetry.mockImplementation(async (op: () => Promise<unknown>) => op());

      const { queryWithResilience } = await import('../client');
      const result = await queryWithResilience(operation);

      expect(result).toBe('query-result');
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(mockWithRetry).toHaveBeenCalledTimes(1);
      expect(operation).toHaveBeenCalledTimes(1);
      delete process.env.DATABASE_URL;
    });

    it('passes retry options through to withRetry', async () => {
      process.env.DATABASE_URL = 'postgres://test:test@localhost/testdb';
      const operation = vi.fn().mockResolvedValue('ok');
      const retryOpts = { maxAttempts: 5, baseDelayMs: 200 };

      mockExecute.mockImplementation(async (fn: () => Promise<unknown>) => fn());
      mockWithRetry.mockImplementation(async (op: () => Promise<unknown>) => op());

      const { queryWithResilience } = await import('../client');
      await queryWithResilience(operation, retryOpts);

      expect(mockWithRetry).toHaveBeenCalledWith(operation, retryOpts);
      delete process.env.DATABASE_URL;
    });

    it('propagates circuit breaker errors', async () => {
      process.env.DATABASE_URL = 'postgres://test:test@localhost/testdb';
      mockExecute.mockRejectedValue(new Error('Circuit is open'));

      const { queryWithResilience } = await import('../client');
      await expect(
        queryWithResilience(() => Promise.resolve('never'))
      ).rejects.toThrow('Circuit is open');
      delete process.env.DATABASE_URL;
    });

    it('propagates retry errors', async () => {
      process.env.DATABASE_URL = 'postgres://test:test@localhost/testdb';
      mockExecute.mockImplementation(async (fn: () => Promise<unknown>) => fn());
      mockWithRetry.mockRejectedValue(new Error('All retries exhausted'));

      const { queryWithResilience } = await import('../client');
      await expect(
        queryWithResilience(() => Promise.resolve('never'))
      ).rejects.toThrow('All retries exhausted');
      delete process.env.DATABASE_URL;
    });
  });

  describe('PF-525: neon-http transaction support', () => {
    it('NeonHttpSession.transaction() throws because neon-http does not support interactive transactions', async () => {
      vi.resetModules();

      // Import the actual NeonHttpSession to verify its transaction method
      const sessionModule = await import('drizzle-orm/neon-http/session');
      const NeonHttpSession = sessionModule.NeonHttpSession;
      const fakeSql = (() => Promise.resolve({ rows: [] }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session = new NeonHttpSession(fakeSql as any, {} as any, undefined);

      // The session's transaction() must throw -- this protects against
      // accidentally calling db.transaction() with the neon-http driver.
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session as any).transaction(async () => { /* never reached */ })
      ).rejects.toThrow('No transactions support in neon-http driver');
    });
  });
});
