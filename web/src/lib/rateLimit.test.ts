import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { rateLimit } from './rateLimit';

describe('rateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within limit', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const result1 = rateLimit('user1', 3, 60000);
    expect(result1.allowed).toBe(true);
    expect(result1.remaining).toBe(2);

    const result2 = rateLimit('user1', 3, 60000);
    expect(result2.allowed).toBe(true);
    expect(result2.remaining).toBe(1);

    const result3 = rateLimit('user1', 3, 60000);
    expect(result3.allowed).toBe(true);
    expect(result3.remaining).toBe(0);
  });

  it('denies requests exceeding limit', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    // Exhaust limit
    rateLimit('user2', 2, 60000);
    rateLimit('user2', 2, 60000);

    // Third request should be denied
    const result = rateLimit('user2', 2, 60000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('resets after window expires', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    // Exhaust limit
    rateLimit('user3', 2, 60000);
    rateLimit('user3', 2, 60000);

    // Third request denied
    const denied = rateLimit('user3', 2, 60000);
    expect(denied.allowed).toBe(false);

    // Advance time past window
    vi.setSystemTime(now + 61000);

    // Should be allowed again
    const allowed = rateLimit('user3', 2, 60000);
    expect(allowed.allowed).toBe(true);
    expect(allowed.remaining).toBe(1);
  });

  it('tracks different keys independently', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    // Exhaust limit for user4
    rateLimit('user4', 1, 60000);
    const user4Denied = rateLimit('user4', 1, 60000);
    expect(user4Denied.allowed).toBe(false);

    // user5 should still be allowed
    const user5Allowed = rateLimit('user5', 1, 60000);
    expect(user5Allowed.allowed).toBe(true);
  });

  it('returns correct remaining count', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const result1 = rateLimit('user6', 5, 60000);
    expect(result1.remaining).toBe(4);

    const result2 = rateLimit('user6', 5, 60000);
    expect(result2.remaining).toBe(3);

    const result3 = rateLimit('user6', 5, 60000);
    expect(result3.remaining).toBe(2);
  });

  it('returns correct resetAt timestamp', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const windowMs = 60000;
    const result = rateLimit('user7', 3, windowMs);

    expect(result.resetAt).toBe(now + windowMs);
  });

  it('handles sliding window correctly', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const windowMs = 60000; // 1 minute window

    // Make 2 requests at t=0
    rateLimit('user8', 3, windowMs);
    rateLimit('user8', 3, windowMs);

    // Advance 30 seconds
    vi.setSystemTime(now + 30000);

    // Make 1 request at t=30s
    const result1 = rateLimit('user8', 3, windowMs);
    expect(result1.allowed).toBe(true);
    expect(result1.remaining).toBe(0);

    // At t=30s, all 3 requests are still in window
    const result2 = rateLimit('user8', 3, windowMs);
    expect(result2.allowed).toBe(false);

    // Advance to t=61s (first 2 requests now outside window)
    vi.setSystemTime(now + 61000);

    // Should be allowed now (only the request at t=30s is in window)
    const result3 = rateLimit('user8', 3, windowMs);
    expect(result3.allowed).toBe(true);
    expect(result3.remaining).toBe(1);
  });
});
