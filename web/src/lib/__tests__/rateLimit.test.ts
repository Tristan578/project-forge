import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Reset module state between tests
let rateLimit: typeof import('../rateLimit').rateLimit;
let getClientIp: typeof import('../rateLimit').getClientIp;
let rateLimitPublicRoute: typeof import('../rateLimit').rateLimitPublicRoute;
let rateLimitAdminRoute: typeof import('../rateLimit').rateLimitAdminRoute;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const mod = await import('../rateLimit');
  rateLimit = mod.rateLimit;
  getClientIp = mod.getClientIp;
  rateLimitPublicRoute = mod.rateLimitPublicRoute;
  rateLimitAdminRoute = mod.rateLimitAdminRoute;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rateLimit', () => {
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

describe('getClientIp - spoofing protection', () => {
  it('should reject X-Forwarded-For with script injection', () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-forwarded-for': '<script>alert(1)</script>' },
    });
    expect(getClientIp(req)).toBe('unknown');
  });

  it('should reject X-Forwarded-For with path traversal characters', () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-forwarded-for': '../../etc/passwd' },
    });
    expect(getClientIp(req)).toBe('unknown');
  });

  it('should reject X-Forwarded-For with spaces in IP', () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-forwarded-for': 'not an ip' },
    });
    expect(getClientIp(req)).toBe('unknown');
  });

  it('should reject overly long X-Forwarded-For values', () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-forwarded-for': '1'.repeat(100) },
    });
    expect(getClientIp(req)).toBe('unknown');
  });

  it('should accept valid IPv6 addresses', () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-forwarded-for': '2001:db8::1' },
    });
    expect(getClientIp(req)).toBe('2001:db8::1');
  });

  it('should accept valid IPv4-mapped IPv6 addresses', () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-forwarded-for': '::ffff:192.168.1.1' },
    });
    expect(getClientIp(req)).toBe('::ffff:192.168.1.1');
  });

  it('should fall back to last IP when first is spoofed', () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-forwarded-for': '<bad>, 10.0.0.1' },
    });
    expect(getClientIp(req)).toBe('10.0.0.1');
  });

  it('should reject invalid x-real-ip header', () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-real-ip': 'DROP TABLE users;' },
    });
    expect(getClientIp(req)).toBe('unknown');
  });
});

describe('rateLimitAdminRoute', () => {
  it('should return null when under limit', () => {
    const result = rateLimitAdminRoute('admin-1', 'admin-test', 10, 60_000);
    expect(result).toBeNull();
  });

  it('should return 429 when admin exceeds limit', () => {
    for (let i = 0; i < 10; i++) {
      rateLimitAdminRoute('admin-2', 'admin-test-2', 10, 60_000);
    }
    const result = rateLimitAdminRoute('admin-2', 'admin-test-2', 10, 60_000);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it('should separate limits by userId', () => {
    for (let i = 0; i < 10; i++) {
      rateLimitAdminRoute('admin-3', 'admin-test-3', 10, 60_000);
    }
    // Different user should not be rate limited
    const result = rateLimitAdminRoute('admin-4', 'admin-test-3', 10, 60_000);
    expect(result).toBeNull();
  });

  it('should separate limits by endpoint', () => {
    for (let i = 0; i < 10; i++) {
      rateLimitAdminRoute('admin-5', 'endpoint-x', 10, 60_000);
    }
    // Same user, different endpoint should not be rate limited
    const result = rateLimitAdminRoute('admin-5', 'endpoint-y', 10, 60_000);
    expect(result).toBeNull();
  });

  it('should reset after window expires', () => {
    for (let i = 0; i < 10; i++) {
      rateLimitAdminRoute('admin-6', 'admin-test-4', 10, 1_000);
    }
    let result = rateLimitAdminRoute('admin-6', 'admin-test-4', 10, 1_000);
    expect(result).not.toBeNull();

    vi.advanceTimersByTime(1_100);

    result = rateLimitAdminRoute('admin-6', 'admin-test-4', 10, 1_000);
    expect(result).toBeNull();
  });

  it('should include rate limit headers in 429 response', () => {
    for (let i = 0; i < 2; i++) {
      rateLimitAdminRoute('admin-7', 'admin-test-5', 2, 60_000);
    }
    const result = rateLimitAdminRoute('admin-7', 'admin-test-5', 2, 60_000);
    expect(result).not.toBeNull();
    expect(result!.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(result!.headers.get('Retry-After')).toBeTruthy();
    expect(result!.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });
});
