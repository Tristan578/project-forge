import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Reset module state between tests
let rateLimit: typeof import('../rateLimit').rateLimit;
let getClientIp: typeof import('../rateLimit').getClientIp;
let rateLimitPublicRoute: typeof import('../rateLimit').rateLimitPublicRoute;

describe('rateLimit', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const mod = await import('../rateLimit');
    rateLimit = mod.rateLimit;
    getClientIp = mod.getClientIp;
    rateLimitPublicRoute = mod.rateLimitPublicRoute;
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

describe('getClientIp', () => {
  it('should extract IP from x-forwarded-for header', () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' },
    });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('should extract IP from x-real-ip header', () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-real-ip': '5.6.7.8' },
    });
    expect(getClientIp(req)).toBe('5.6.7.8');
  });

  it('should return unknown when no IP headers present', () => {
    const req = new NextRequest('http://localhost:3000/api/test');
    expect(getClientIp(req)).toBe('unknown');
  });
});

describe('rateLimitPublicRoute', () => {
  it('should return null when under limit', () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });
    const result = rateLimitPublicRoute(req, 'test-endpoint', 5, 60_000);
    expect(result).toBeNull();
  });

  it('should return 429 response when over limit', () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-forwarded-for': '10.0.0.99' },
    });
    // Exhaust the limit
    for (let i = 0; i < 2; i++) {
      rateLimitPublicRoute(req, 'test-endpoint-2', 2, 60_000);
    }
    const result = rateLimitPublicRoute(req, 'test-endpoint-2', 2, 60_000);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it('should separate limits by endpoint', () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-forwarded-for': '10.0.0.50' },
    });
    rateLimitPublicRoute(req, 'endpoint-a', 1, 60_000);
    const result = rateLimitPublicRoute(req, 'endpoint-b', 1, 60_000);
    expect(result).toBeNull();
  });
});
