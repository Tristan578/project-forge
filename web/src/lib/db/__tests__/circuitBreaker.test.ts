import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Closed state ──────────────────────────────────────────────────────────

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
    await expect(cb.execute(() => Promise.reject(new Error('boom')))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(new Error('boom')))).rejects.toThrow();
    // One success — resets counter
    await cb.execute(() => Promise.resolve('ok'));
    // Should still be closed and require 3 more failures to open
    await expect(cb.execute(() => Promise.reject(new Error('boom')))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(new Error('boom')))).rejects.toThrow();
    expect(cb.getState()).toBe('closed');
  });

  // ── Closed → Open transition ──────────────────────────────────────────────

  it('transitions to open after threshold failures', async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      await expect(
        cb.execute(() => Promise.reject(new Error('transient')))
      ).rejects.toThrow('transient');
    }
    expect(cb.getState()).toBe('open');
  });

  it('does not open before the threshold is reached', async () => {
    const cb = makeBreaker({ failureThreshold: 5 });
    for (let i = 0; i < 4; i++) {
      await expect(
        cb.execute(() => Promise.reject(new Error('err')))
      ).rejects.toThrow();
    }
    expect(cb.getState()).toBe('closed');
  });

  // ── Open state ────────────────────────────────────────────────────────────

  it('throws CircuitBreakerOpenError immediately when open', async () => {
    const cb = makeBreaker({ failureThreshold: 1 });
    await expect(cb.execute(() => Promise.reject(new Error('err')))).rejects.toThrow();
    expect(cb.getState()).toBe('open');

    const operation = vi.fn().mockResolvedValue('should not run');
    await expect(cb.execute(operation)).rejects.toThrow(CircuitBreakerOpenError);
    expect(operation).not.toHaveBeenCalled();
  });

  it('rejects with CircuitBreakerOpenError (not the underlying error) when open', async () => {
    const cb = makeBreaker({ failureThreshold: 1 });
    await expect(cb.execute(() => Promise.reject(new Error('original')))).rejects.toThrow();

    const error = await cb.execute(() => Promise.resolve('x')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CircuitBreakerOpenError);
  });

  // ── Open → Half-Open transition ───────────────────────────────────────────

  it('transitions to half-open after the open timeout', async () => {
    const cb = makeBreaker({ failureThreshold: 1, openTimeoutMs: 5_000 });
    await expect(cb.execute(() => Promise.reject(new Error('err')))).rejects.toThrow();
    expect(cb.getState()).toBe('open');

    vi.advanceTimersByTime(5_000);
    expect(cb.getState()).toBe('half-open');
  });

  it('remains open before the timeout elapses', async () => {
    const cb = makeBreaker({ failureThreshold: 1, openTimeoutMs: 10_000 });
    await expect(cb.execute(() => Promise.reject(new Error('err')))).rejects.toThrow();

    vi.advanceTimersByTime(9_999);
    expect(cb.getState()).toBe('open');
  });

  // ── Half-Open → Closed on success ─────────────────────────────────────────

  it('closes the circuit when the probe succeeds in half-open state', async () => {
    const cb = makeBreaker({ failureThreshold: 1, openTimeoutMs: 1_000 });
    await expect(cb.execute(() => Promise.reject(new Error('err')))).rejects.toThrow();

    vi.advanceTimersByTime(1_000);
    expect(cb.getState()).toBe('half-open');

    const result = await cb.execute(() => Promise.resolve('recovery'));
    expect(result).toBe('recovery');
    expect(cb.getState()).toBe('closed');
  });

  it('resets failure counter to 0 after closing from half-open', async () => {
    const cb = makeBreaker({ failureThreshold: 2, openTimeoutMs: 1_000 });
    // Force to half-open
    await expect(cb.execute(() => Promise.reject(new Error('e')))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(new Error('e')))).rejects.toThrow();
    vi.advanceTimersByTime(1_000);

    await cb.execute(() => Promise.resolve('ok'));
    const stats = cb.getStats();
    expect(stats.state).toBe('closed');
    expect(stats.consecutiveFailures).toBe(0);
  });

  // ── Half-Open → Open on failure ───────────────────────────────────────────

  it('reopens the circuit when the probe fails in half-open state', async () => {
    const cb = makeBreaker({ failureThreshold: 1, openTimeoutMs: 1_000 });
    await expect(cb.execute(() => Promise.reject(new Error('err')))).rejects.toThrow();

    vi.advanceTimersByTime(1_000);
    expect(cb.getState()).toBe('half-open');

    await expect(
      cb.execute(() => Promise.reject(new Error('still failing')))
    ).rejects.toThrow('still failing');

    expect(cb.getState()).toBe('open');
  });

  it('resets the open timer when reopened from half-open', async () => {
    const cb = makeBreaker({ failureThreshold: 1, openTimeoutMs: 1_000 });
    await expect(cb.execute(() => Promise.reject(new Error('err')))).rejects.toThrow();

    // Enter half-open
    vi.advanceTimersByTime(1_000);
    // Probe fails — back to open
    await expect(
      cb.execute(() => Promise.reject(new Error('probe fail')))
    ).rejects.toThrow();

    // Advance by less than timeout — should still be open
    vi.advanceTimersByTime(500);
    expect(cb.getState()).toBe('open');

    // Advance past timeout — should be half-open again
    vi.advanceTimersByTime(600);
    expect(cb.getState()).toBe('half-open');
  });

  // ── getStats ──────────────────────────────────────────────────────────────

  it('getStats reports correct state and failure count', async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    await expect(cb.execute(() => Promise.reject(new Error('e')))).rejects.toThrow();
    const stats = cb.getStats();
    expect(stats.state).toBe('closed');
    expect(stats.consecutiveFailures).toBe(1);
    expect(stats.lastOpenedAt).toBeNull();
  });

  it('getStats reports lastOpenedAt when open', async () => {
    const cb = makeBreaker({ failureThreshold: 1 });
    const before = Date.now();
    await expect(cb.execute(() => Promise.reject(new Error('e')))).rejects.toThrow();
    const stats = cb.getStats();
    expect(stats.lastOpenedAt).toBeGreaterThanOrEqual(before);
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  it('reset() restores closed state and clears counters', async () => {
    const cb = makeBreaker({ failureThreshold: 1 });
    await expect(cb.execute(() => Promise.reject(new Error('e')))).rejects.toThrow();
    expect(cb.getState()).toBe('open');

    cb.reset();
    expect(cb.getState()).toBe('closed');
    const stats = cb.getStats();
    expect(stats.consecutiveFailures).toBe(0);
    expect(stats.lastOpenedAt).toBeNull();
  });
});
