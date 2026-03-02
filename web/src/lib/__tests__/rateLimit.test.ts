import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Reset module state between tests
let rateLimit: typeof import('../rateLimit').rateLimit;

describe('rateLimit', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const mod = await import('../rateLimit');
    rateLimit = mod.rateLimit;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow requests under the limit', () => {
    const result = rateLimit('user-1', 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('should track remaining requests', () => {
    rateLimit('user-2', 3, 60_000);
    rateLimit('user-2', 3, 60_000);
    const result = rateLimit('user-2', 3, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('should deny requests over the limit', () => {
    rateLimit('user-3', 2, 60_000);
    rateLimit('user-3', 2, 60_000);
    const result = rateLimit('user-3', 2, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('should separate different keys', () => {
    rateLimit('key-a', 1, 60_000);
    const result = rateLimit('key-b', 1, 60_000);
    expect(result.allowed).toBe(true);
  });

  it('should reset after window expires', () => {
    rateLimit('user-4', 1, 1_000);
    let result = rateLimit('user-4', 1, 1_000);
    expect(result.allowed).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(1_100);

    result = rateLimit('user-4', 1, 1_000);
    expect(result.allowed).toBe(true);
  });

  it('should provide a resetAt timestamp', () => {
    const result = rateLimit('user-5', 5, 60_000);
    expect(result.resetAt).toBeGreaterThan(Date.now() - 1);
  });
});
