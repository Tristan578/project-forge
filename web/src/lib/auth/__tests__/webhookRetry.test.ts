import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  enqueueRetry,
  processRetryQueue,
  isTransientError,
  calculateDelay,
  getQueueStatus,
  clearQueue,
  setConfig,
  resetConfig,
} from '@/lib/auth/webhookRetry';

describe('webhookRetry', () => {
  beforeEach(() => {
    clearQueue();
    resetConfig();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // isTransientError
  // ---------------------------------------------------------------------------
  describe('isTransientError', () => {
    it('returns true for TypeError (fetch network errors)', () => {
      expect(isTransientError(new TypeError('fetch failed'))).toBe(true);
    });

    it('returns true for timeout errors', () => {
      expect(isTransientError(new Error('Request timeout'))).toBe(true);
    });

    it('returns true for connection errors', () => {
      expect(isTransientError(new Error('ECONNRESET'))).toBe(true);
      expect(isTransientError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isTransientError(new Error('socket hang up'))).toBe(true);
    });

    it('returns true for database errors', () => {
      expect(isTransientError(new Error('database connection failed'))).toBe(true);
    });

    it('returns true for rate limit errors', () => {
      expect(isTransientError(new Error('rate limit exceeded'))).toBe(true);
      expect(isTransientError(new Error('too many requests'))).toBe(true);
    });

    it('returns false for validation errors', () => {
      expect(isTransientError(new Error('No email found in Clerk data'))).toBe(false);
    });

    it('returns false for auth errors', () => {
      expect(isTransientError(new Error('Unauthorized'))).toBe(false);
    });

    it('handles string errors', () => {
      expect(isTransientError('connection reset')).toBe(true);
      expect(isTransientError('invalid data')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // calculateDelay
  // ---------------------------------------------------------------------------
  describe('calculateDelay', () => {
    it('increases exponentially', () => {
      // Use fixed config with no jitter influence check
      const cfg = { maxRetries: 5, baseDelayMs: 1000, maxDelayMs: 60000, maxQueueSize: 100 };
      const d0 = calculateDelay(0, cfg);
      const d1 = calculateDelay(1, cfg);
      const d2 = calculateDelay(2, cfg);

      // Base delay is 1000ms, so attempt 0 = 1000 + jitter, attempt 1 = 2000 + jitter, etc.
      expect(d0).toBeGreaterThanOrEqual(1000);
      expect(d0).toBeLessThanOrEqual(1250); // 1000 + 25% jitter
      expect(d1).toBeGreaterThanOrEqual(2000);
      expect(d2).toBeGreaterThanOrEqual(4000);
    });

    it('caps at maxDelayMs', () => {
      const cfg = { maxRetries: 10, baseDelayMs: 1000, maxDelayMs: 5000, maxQueueSize: 100 };
      const d10 = calculateDelay(10, cfg);
      // 1000 * 2^10 = 1024000 but capped at 5000 + 25% jitter = max 6250
      expect(d10).toBeLessThanOrEqual(6250);
    });
  });

  // ---------------------------------------------------------------------------
  // enqueueRetry
  // ---------------------------------------------------------------------------
  describe('enqueueRetry', () => {
    it('adds entry to the queue', () => {
      const result = enqueueRetry('user.created', { id: 'u1' }, new Error('timeout'));
      expect(result).toBe(true);
      expect(getQueueStatus().size).toBe(1);

      const entry = getQueueStatus().entries[0];
      expect(entry.eventType).toBe('user.created');
      expect(entry.payload).toEqual({ id: 'u1' });
      expect(entry.attempt).toBe(0);
      expect(entry.lastError).toBe('timeout');
    });

    it('rejects when queue is full', () => {
      setConfig({ maxQueueSize: 2, maxRetries: 5, baseDelayMs: 100, maxDelayMs: 1000 });
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      enqueueRetry('user.created', { id: '1' }, new Error('err'));
      enqueueRetry('user.created', { id: '2' }, new Error('err'));
      const result = enqueueRetry('user.created', { id: '3' }, new Error('err'));

      expect(result).toBe(false);
      expect(getQueueStatus().size).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // processRetryQueue
  // ---------------------------------------------------------------------------
  describe('processRetryQueue', () => {
    it('processes due entries and removes on success', async () => {
      setConfig({ maxRetries: 3, baseDelayMs: 0, maxDelayMs: 0, maxQueueSize: 10 });

      enqueueRetry('user.created', { id: 'u1' }, new Error('timeout'));

      // Manually set nextRetryAt to now so it's due
      const status = getQueueStatus();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (status.entries[0] as any).nextRetryAt = 0;

      const handler = vi.fn().mockResolvedValue(undefined);
      const processed = await processRetryQueue(handler);

      expect(processed).toBe(1);
      expect(handler).toHaveBeenCalledWith('user.created', { id: 'u1' });
      expect(getQueueStatus().size).toBe(0);
    });

    it('re-enqueues on transient failure', async () => {
      setConfig({ maxRetries: 3, baseDelayMs: 0, maxDelayMs: 0, maxQueueSize: 10 });

      enqueueRetry('user.updated', { id: 'u2' }, new Error('timeout'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (getQueueStatus().entries[0] as any).nextRetryAt = 0;

      const handler = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
      const processed = await processRetryQueue(handler);

      expect(processed).toBe(0);
      expect(getQueueStatus().size).toBe(1);
      expect(getQueueStatus().entries[0].attempt).toBe(1);
    });

    it('discards after max retries', async () => {
      setConfig({ maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0, maxQueueSize: 10 });
      vi.spyOn(console, 'error').mockImplementation(() => {});

      enqueueRetry('user.created', { id: 'u3' }, new Error('timeout'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (getQueueStatus().entries[0] as any).nextRetryAt = 0;

      const handler = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
      await processRetryQueue(handler);

      expect(getQueueStatus().size).toBe(0);
    });

    it('discards on permanent error', async () => {
      setConfig({ maxRetries: 5, baseDelayMs: 0, maxDelayMs: 0, maxQueueSize: 10 });
      vi.spyOn(console, 'error').mockImplementation(() => {});

      enqueueRetry('user.created', { id: 'u4' }, new Error('timeout'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (getQueueStatus().entries[0] as any).nextRetryAt = 0;

      // Permanent error (not transient)
      const handler = vi.fn().mockRejectedValue(new Error('No email found'));
      await processRetryQueue(handler);

      expect(getQueueStatus().size).toBe(0);
    });

    it('skips entries not yet due', async () => {
      setConfig({ maxRetries: 3, baseDelayMs: 60000, maxDelayMs: 60000, maxQueueSize: 10 });

      enqueueRetry('user.created', { id: 'u5' }, new Error('timeout'));
      // nextRetryAt is in the future — should not be processed

      const handler = vi.fn().mockResolvedValue(undefined);
      const processed = await processRetryQueue(handler);

      expect(processed).toBe(0);
      expect(handler).not.toHaveBeenCalled();
      expect(getQueueStatus().size).toBe(1);
    });

    it('processes multiple due entries', async () => {
      setConfig({ maxRetries: 3, baseDelayMs: 0, maxDelayMs: 0, maxQueueSize: 10 });

      enqueueRetry('user.created', { id: 'u6' }, new Error('timeout'));
      enqueueRetry('user.updated', { id: 'u7' }, new Error('timeout'));

      for (const entry of getQueueStatus().entries) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (entry as any).nextRetryAt = 0;
      }

      const handler = vi.fn().mockResolvedValue(undefined);
      const processed = await processRetryQueue(handler);

      expect(processed).toBe(2);
      expect(getQueueStatus().size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getQueueStatus
  // ---------------------------------------------------------------------------
  describe('getQueueStatus', () => {
    it('returns empty queue by default', () => {
      const status = getQueueStatus();
      expect(status.size).toBe(0);
      expect(status.entries).toHaveLength(0);
      expect(status.config.maxRetries).toBe(5);
    });

    it('reflects config changes', () => {
      setConfig({ maxRetries: 10 });
      expect(getQueueStatus().config.maxRetries).toBe(10);
    });
  });
});
