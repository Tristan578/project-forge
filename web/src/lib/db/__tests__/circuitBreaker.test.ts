import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockCaptureException = vi.fn();
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

import { CircuitBreaker, CircuitBreakerOpenError } from '../circuitBreaker';

function makeBreaker(options?: { failureThreshold?: number; openTimeoutMs?: number }) {
  return new CircuitBreaker({
    failureThreshold: options?.failureThreshold ?? 3,
    openTimeoutMs: options?.openTimeoutMs ?? 30_000,
  });
}

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCaptureException.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -- Closed state --

  it('starts in closed state', () => {
    const cb = makeBreaker();
    expect(cb.getState()).toBe('closed');
  });

  it('allows operations to pass through in closed state', async () => {
    const cb = makeBreaker();
    const result = await cb.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('resets failure counter on success in closed state', async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    // Two failures
    await expect(cb.execute(() => Promise.reject(new Error('connection refused')))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(new Error('connection refused')))).rejects.toThrow();
    // One success — resets counter
    await cb.execute(() => Promise.resolve('ok'));
    // Should still be closed and require 3 more failures to open
    await expect(cb.execute(() => Promise.reject(new Error('connection refused')))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(new Error('connection refused')))).rejects.toThrow();
    expect(cb.getState()).toBe('closed');
  });

  // -- Closed -> Open transition --

  it('transitions to open after threshold failures', async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      await expect(
        cb.execute(() => Promise.reject(new Error('connection refused')))
      ).rejects.toThrow('connection refused');
    }
    expect(cb.getState()).toBe('open');
  });

  it('does not open before the threshold is reached', async () => {
    const cb = makeBreaker({ failureThreshold: 5 });
    for (let i = 0; i < 4; i++) {
      await expect(
        cb.execute(() => Promise.reject(new Error('connection timeout')))
      ).rejects.toThrow();
    }
    expect(cb.getState()).toBe('closed');
  });

  it('does not count non-transient errors toward the threshold', async () => {
    const cb = makeBreaker({ failureThreshold: 2 });
    // Auth errors are not transient
    for (let i = 0; i < 5; i++) {
      await expect(
        cb.execute(() => Promise.reject(new Error('authentication failed')))
      ).rejects.toThrow();
    }
    // Should still be closed — non-transient errors are not counted
    expect(cb.getState()).toBe('closed');
    expect(cb.getStats().consecutiveFailures).toBe(0);
  });

  // -- Open state --

  it('throws CircuitBreakerOpenError immediately when open', async () => {
    const cb = makeBreaker({ failureThreshold: 1 });
    await expect(cb.execute(() => Promise.reject(new Error('connection timeout')))).rejects.toThrow();
    expect(cb.getState()).toBe('open');

    const operation = vi.fn().mockResolvedValue('should not run');
    await expect(cb.execute(operation)).rejects.toThrow(CircuitBreakerOpenError);
    expect(operation).not.toHaveBeenCalled();
  });

  it('rejects with CircuitBreakerOpenError (not the underlying error) when open', async () => {
    const cb = makeBreaker({ failureThreshold: 1 });
    await expect(cb.execute(() => Promise.reject(new Error('connection terminated')))).rejects.toThrow();

    const error = await cb.execute(() => Promise.resolve('x')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CircuitBreakerOpenError);
  });

  // -- Open -> Half-Open transition --

  it('transitions to half-open after the open timeout', async () => {
    const cb = makeBreaker({ failureThreshold: 1, openTimeoutMs: 5_000 });
    await expect(cb.execute(() => Promise.reject(new Error('connection timeout')))).rejects.toThrow();
    expect(cb.getState()).toBe('open');

    vi.advanceTimersByTime(5_000);
    expect(cb.getState()).toBe('half-open');
  });

  it('remains open before the timeout elapses', async () => {
    const cb = makeBreaker({ failureThreshold: 1, openTimeoutMs: 10_000 });
    await expect(cb.execute(() => Promise.reject(new Error('connection timeout')))).rejects.toThrow();

    vi.advanceTimersByTime(9_999);
    expect(cb.getState()).toBe('open');
  });

  // -- Half-Open -> Closed on success --

  it('closes the circuit when the probe succeeds in half-open state', async () => {
    const cb = makeBreaker({ failureThreshold: 1, openTimeoutMs: 1_000 });
    await expect(cb.execute(() => Promise.reject(new Error('connection timeout')))).rejects.toThrow();

    vi.advanceTimersByTime(1_000);
    expect(cb.getState()).toBe('half-open');

    const result = await cb.execute(() => Promise.resolve('recovery'));
    expect(result).toBe('recovery');
    expect(cb.getState()).toBe('closed');
  });

  it('resets failure counter to 0 after closing from half-open', async () => {
    const cb = makeBreaker({ failureThreshold: 2, openTimeoutMs: 1_000 });
    // Force to half-open
    await expect(cb.execute(() => Promise.reject(new Error('connection terminated')))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(new Error('connection terminated')))).rejects.toThrow();
    vi.advanceTimersByTime(1_000);

    await cb.execute(() => Promise.resolve('ok'));
    const stats = cb.getStats();
    expect(stats.state).toBe('closed');
    expect(stats.consecutiveFailures).toBe(0);
  });

  // -- Half-Open -> Open on failure --

  it('reopens the circuit when the probe fails in half-open state', async () => {
    const cb = makeBreaker({ failureThreshold: 1, openTimeoutMs: 1_000 });
    await expect(cb.execute(() => Promise.reject(new Error('connection timeout')))).rejects.toThrow();

    vi.advanceTimersByTime(1_000);
    expect(cb.getState()).toBe('half-open');

    await expect(
      cb.execute(() => Promise.reject(new Error('connection refused again')))
    ).rejects.toThrow('connection refused again');

    expect(cb.getState()).toBe('open');
  });

  it('resets the open timer when reopened from half-open', async () => {
    const cb = makeBreaker({ failureThreshold: 1, openTimeoutMs: 1_000 });
    await expect(cb.execute(() => Promise.reject(new Error('connection timeout')))).rejects.toThrow();

    // Enter half-open
    vi.advanceTimersByTime(1_000);
    // Probe fails — back to open
    await expect(
      cb.execute(() => Promise.reject(new Error('connection refused probe')))
    ).rejects.toThrow();

    // Advance by less than timeout — should still be open
    vi.advanceTimersByTime(500);
    expect(cb.getState()).toBe('open');

    // Advance past timeout — should be half-open again
    vi.advanceTimersByTime(600);
    expect(cb.getState()).toBe('half-open');
  });

  // -- getStats --

  it('getStats reports correct state and failure count', async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    await expect(cb.execute(() => Promise.reject(new Error('connection terminated')))).rejects.toThrow();
    const stats = cb.getStats();
    expect(stats.state).toBe('closed');
    expect(stats.consecutiveFailures).toBe(1);
    expect(stats.lastOpenedAt).toBeNull();
  });

  it('getStats reports lastOpenedAt when open', async () => {
    const cb = makeBreaker({ failureThreshold: 1 });
    const before = Date.now();
    await expect(cb.execute(() => Promise.reject(new Error('connection terminated')))).rejects.toThrow();
    const stats = cb.getStats();
    expect(stats.lastOpenedAt).toBeGreaterThanOrEqual(before);
  });

  // -- Sentry alerting (#8244) --

  it('fires a Sentry alert when the circuit opens', async () => {
    const cb = makeBreaker({ failureThreshold: 2 });
    await expect(cb.execute(() => Promise.reject(new Error('connection timeout')))).rejects.toThrow();
    expect(mockCaptureException).not.toHaveBeenCalled();

    await expect(cb.execute(() => Promise.reject(new Error('connection timeout')))).rejects.toThrow();
    expect(cb.getState()).toBe('open');
    expect(mockCaptureException).toHaveBeenCalledOnce();
    expect(mockCaptureException.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(mockCaptureException.mock.calls[0][0].message).toContain('circuit breaker opened');
    expect(mockCaptureException.mock.calls[0][1]).toMatchObject({
      from: 'closed',
      to: 'open',
      consecutiveFailures: 2,
    });
  });

  it('does not fire Sentry alert for half-open or closed transitions', async () => {
    const cb = makeBreaker({ failureThreshold: 1, openTimeoutMs: 1_000 });
    await expect(cb.execute(() => Promise.reject(new Error('connection timeout')))).rejects.toThrow();
    mockCaptureException.mockClear();

    // half-open transition — no alert
    vi.advanceTimersByTime(1_000);
    expect(cb.getState()).toBe('half-open');
    expect(mockCaptureException).not.toHaveBeenCalled();

    // closed transition — no alert
    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.getState()).toBe('closed');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('fires Sentry alert again when circuit reopens from half-open', async () => {
    const cb = makeBreaker({ failureThreshold: 1, openTimeoutMs: 1_000 });
    await expect(cb.execute(() => Promise.reject(new Error('connection timeout')))).rejects.toThrow();
    expect(mockCaptureException).toHaveBeenCalledOnce();
    mockCaptureException.mockClear();

    vi.advanceTimersByTime(1_000);
    // Probe fails — back to open
    await expect(cb.execute(() => Promise.reject(new Error('connection timeout')))).rejects.toThrow();
    expect(cb.getState()).toBe('open');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });

  // -- reset --

  it('reset() restores closed state and clears counters', async () => {
    const cb = makeBreaker({ failureThreshold: 1 });
    await expect(cb.execute(() => Promise.reject(new Error('connection terminated')))).rejects.toThrow();
    expect(cb.getState()).toBe('open');

    cb.reset();
    expect(cb.getState()).toBe('closed');
    const stats = cb.getStats();
    expect(stats.consecutiveFailures).toBe(0);
    expect(stats.lastOpenedAt).toBeNull();
  });
});
