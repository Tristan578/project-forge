import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { withRetry, isTransientError, computeDelay } from '../withRetry';

describe('isTransientError', () => {
  it('returns true for connection refused', () => {
    expect(isTransientError(new Error('connection refused'))).toBe(true);
  });

  it('returns true for ECONNREFUSED code', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(isTransientError(err)).toBe(true);
  });

  it('returns true for timeout', () => {
    expect(isTransientError(new Error('connection timeout exceeded'))).toBe(true);
  });

  it('returns true for network errors', () => {
    expect(isTransientError(new Error('network failure'))).toBe(true);
  });

  it('returns true for service unavailable', () => {
    expect(isTransientError(new Error('service unavailable'))).toBe(true);
  });

  it('returns true for too many connections', () => {
    expect(isTransientError(new Error('too many connections'))).toBe(true);
  });

  it('returns false for auth errors', () => {
    expect(isTransientError(new Error('password authentication failed'))).toBe(false);
  });

  it('returns false for syntax errors', () => {
    expect(isTransientError(new Error('syntax error at or near "SELCT"'))).toBe(false);
  });

  it('returns false for constraint violations', () => {
    expect(isTransientError(new Error('duplicate key value violates unique constraint'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isTransientError('some string')).toBe(false);
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(42)).toBe(false);
  });
});

describe('computeDelay', () => {
  it('applies jitter so result is within expected range', () => {
    const opts = {
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 2000,
      multiplier: 2,
      jitterFactor: 0.25,
    };
    // attempt 0: base = 100ms, ±25% → [75, 125]
    for (let i = 0; i < 20; i++) {
      const delay = computeDelay(0, opts);
      expect(delay).toBeGreaterThanOrEqual(75);
      expect(delay).toBeLessThanOrEqual(125);
    }
  });

  it('caps at maxDelayMs', () => {
    const opts = {
      maxAttempts: 10,
      baseDelayMs: 100,
      maxDelayMs: 500,
      multiplier: 10,
      jitterFactor: 0,
    };
    // attempt 2: 100 * 10^2 = 10000, capped to 500
    const delay = computeDelay(2, opts);
    expect(delay).toBe(500);
  });

  it('returns integer values', () => {
    const opts = {
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 2000,
      multiplier: 2,
      jitterFactor: 0.25,
    };
    const delay = computeDelay(1, opts);
    expect(Number.isInteger(delay)).toBe(true);
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns result immediately on first success', async () => {
    const operation = vi.fn().mockResolvedValue('hello');
    const result = await withRetry(operation, { maxAttempts: 3 });
    expect(result).toBe('hello');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries after a transient failure and succeeds', async () => {
    let calls = 0;
    const operation = vi.fn().mockImplementation(async () => {
      if (calls++ === 0) throw new Error('connection refused');
      return 'success';
    });

    // Run and advance timers to handle the sleep
    const promise = withRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 2000,
      jitterFactor: 0,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('gives up after max attempts and throws the last error', async () => {
    const operation = vi.fn().mockImplementation(async () => {
      throw new Error('connection refused');
    });

    // Attach rejection handler FIRST, then run timers, to prevent
    // Node.js from firing unhandledRejection before the handler is set.
    const promise = withRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 100,
      jitterFactor: 0,
    });
    const assertion = expect(promise).rejects.toThrow('connection refused');
    await vi.runAllTimersAsync();
    await assertion;

    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry non-transient errors', async () => {
    const operation = vi.fn().mockImplementation(async () => {
      throw new Error('password authentication failed for user "app"');
    });

    await expect(
      withRetry(operation, { maxAttempts: 3 })
    ).rejects.toThrow('password authentication failed');

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry syntax errors', async () => {
    const operation = vi.fn().mockImplementation(async () => {
      throw new Error('syntax error at or near "SELCT"');
    });

    await expect(withRetry(operation)).rejects.toThrow('syntax error');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry constraint violations', async () => {
    const operation = vi.fn().mockImplementation(async () => {
      throw new Error('duplicate key value violates unique constraint "users_email_key"');
    });

    await expect(withRetry(operation)).rejects.toThrow('duplicate key');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('delays between retries (jitter applied)', async () => {
    let calls = 0;
    const operation = vi.fn().mockImplementation(async () => {
      if (calls++ < 2) throw new Error('etimedout');
      return 'ok';
    });

    const promise = withRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 200,
      maxDelayMs: 2000,
      multiplier: 2,
      jitterFactor: 0,
    });

    // Verify we need to advance timers for the retries to proceed
    expect(operation).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('uses defaults when no options provided', async () => {
    const operation = vi.fn().mockResolvedValue(42);
    const result = await withRetry(operation);
    expect(result).toBe(42);
  });
});
