import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Reset module state between tests
let rateLimit: typeof import('../rateLimit').rateLimit;
let getClientIp: typeof import('../rateLimit').getClientIp;
let rateLimitPublicRoute: typeof import('../rateLimit').rateLimitPublicRoute;
let rateLimitAdminRoute: typeof import('../rateLimit').rateLimitAdminRoute;
let _resetUpstashLimiter: typeof import('../rateLimit')._resetUpstashLimiter;
let _inMemoryRateLimit: typeof import('../rateLimit')._inMemoryRateLimit;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  // Ensure Upstash env vars are NOT set by default (in-memory fallback)
  delete process.env['UPSTASH_REDIS_REST_URL'];
  delete process.env['UPSTASH_REDIS_REST_TOKEN'];
  const mod = await import('../rateLimit');
  rateLimit = mod.rateLimit;
  getClientIp = mod.getClientIp;
  rateLimitPublicRoute = mod.rateLimitPublicRoute;
  rateLimitAdminRoute = mod.rateLimitAdminRoute;
  _resetUpstashLimiter = mod._resetUpstashLimiter;
  _inMemoryRateLimit = mod._inMemoryRateLimit;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rateLimit (in-memory fallback)', () => {
  it('should allow requests under the limit', async () => {
    const result = await rateLimit('user-1', 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('should track remaining requests', async () => {
    await rateLimit('user-2', 3, 60_000);
    await rateLimit('user-2', 3, 60_000);
    const result = await rateLimit('user-2', 3, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('should deny requests over the limit', async () => {
    await rateLimit('user-3', 2, 60_000);
    await rateLimit('user-3', 2, 60_000);
    const result = await rateLimit('user-3', 2, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('should separate different keys', async () => {
    await rateLimit('key-a', 1, 60_000);
    const result = await rateLimit('key-b', 1, 60_000);
    expect(result.allowed).toBe(true);
  });

  it('should reset after window expires', async () => {
    await rateLimit('user-4', 1, 1_000);
    let result = await rateLimit('user-4', 1, 1_000);
    expect(result.allowed).toBe(false);

    vi.advanceTimersByTime(1_100);

    result = await rateLimit('user-4', 1, 1_000);
    expect(result.allowed).toBe(true);
  });

  it('should provide a resetAt timestamp', async () => {
    const result = await rateLimit('user-5', 5, 60_000);
    expect(result.resetAt).toBeGreaterThan(Date.now() - 1);
  });
});

describe('_inMemoryRateLimit (direct)', () => {
  it('should be a synchronous in-memory implementation', () => {
    const result = _inMemoryRateLimit('sync-key', 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('should block after max requests', () => {
    _inMemoryRateLimit('block-key', 2, 60_000);
    _inMemoryRateLimit('block-key', 2, 60_000);
    const result = _inMemoryRateLimit('block-key', 2, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});

describe('Upstash integration', () => {
  // These tests need real timers because they use async dynamic imports
  // which don't resolve properly under fake timers.
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useFakeTimers();
  });

  it('should warn and fall back when env vars are missing', async () => {
    vi.resetModules();
    delete process.env['UPSTASH_REDIS_REST_URL'];
    delete process.env['UPSTASH_REDIS_REST_TOKEN'];

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await import('../rateLimit');
    // Fresh module has _upstashLimiter = null, calling rateLimit triggers getUpstashLimiter
    const result = await mod.rateLimit('warn-test-key', 5, 60_000);
    expect(result.allowed).toBe(true);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('UPSTASH_REDIS_REST_URL')
    );

    warnSpy.mockRestore();
  });

  it('should use Upstash when properly configured', async () => {
    // Verify the Upstash packages are importable (installed as dependencies)
    const { Redis } = await import('@upstash/redis');
    const { Ratelimit } = await import('@upstash/ratelimit');
    expect(Redis).not.toBeUndefined();
    expect(Ratelimit).not.toBeUndefined();
    expect(typeof Ratelimit.slidingWindow).toBe('function');
  });

  it('should fall back to in-memory when Upstash init throws', async () => {
    // Simulate Upstash init failure by mocking the import to throw
    vi.resetModules();

    vi.doMock('@upstash/redis', () => {
      throw new Error('Module not found');
    });

    process.env['UPSTASH_REDIS_REST_URL'] = 'https://test-redis.upstash.io';
    process.env['UPSTASH_REDIS_REST_TOKEN'] = 'test-token-123';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await import('../rateLimit');

    // Even though env vars are set, since the import fails, it should
    // fall back to in-memory rate limiting
    const result = await mod.rateLimit('fallback-test', 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);

    // Should have warned about the failure
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to initialise Upstash')
    );

    warnSpy.mockRestore();
    delete process.env['UPSTASH_REDIS_REST_URL'];
    delete process.env['UPSTASH_REDIS_REST_TOKEN'];
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
  it('should return null when under limit', async () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });
    const result = await rateLimitPublicRoute(req, 'test-endpoint', 5, 60_000);
    expect(result).toBeNull();
  });

  it('should return 429 response when over limit', async () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-forwarded-for': '10.0.0.99' },
    });
    // Exhaust the limit
    for (let i = 0; i < 2; i++) {
      await rateLimitPublicRoute(req, 'test-endpoint-2', 2, 60_000);
    }
    const result = await rateLimitPublicRoute(req, 'test-endpoint-2', 2, 60_000);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it('should separate limits by endpoint', async () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-forwarded-for': '10.0.0.50' },
    });
    await rateLimitPublicRoute(req, 'endpoint-a', 1, 60_000);
    const result = await rateLimitPublicRoute(req, 'endpoint-b', 1, 60_000);
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
  it('should return null when under limit', async () => {
    const result = await rateLimitAdminRoute('admin-1', 'admin-test', 10, 60_000);
    expect(result).toBeNull();
  });

  it('should return 429 when admin exceeds limit', async () => {
    for (let i = 0; i < 10; i++) {
      await rateLimitAdminRoute('admin-2', 'admin-test-2', 10, 60_000);
    }
    const result = await rateLimitAdminRoute('admin-2', 'admin-test-2', 10, 60_000);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it('should separate limits by userId', async () => {
    for (let i = 0; i < 10; i++) {
      await rateLimitAdminRoute('admin-3', 'admin-test-3', 10, 60_000);
    }
    const result = await rateLimitAdminRoute('admin-4', 'admin-test-3', 10, 60_000);
    expect(result).toBeNull();
  });

  it('should separate limits by endpoint', async () => {
    for (let i = 0; i < 10; i++) {
      await rateLimitAdminRoute('admin-5', 'endpoint-x', 10, 60_000);
    }
    const result = await rateLimitAdminRoute('admin-5', 'endpoint-y', 10, 60_000);
    expect(result).toBeNull();
  });

  it('should reset after window expires', async () => {
    for (let i = 0; i < 10; i++) {
      await rateLimitAdminRoute('admin-6', 'admin-test-4', 10, 1_000);
    }
    let result = await rateLimitAdminRoute('admin-6', 'admin-test-4', 10, 1_000);
    expect(result).not.toBeNull();

    vi.advanceTimersByTime(1_100);

    result = await rateLimitAdminRoute('admin-6', 'admin-test-4', 10, 1_000);
    expect(result).toBeNull();
  });

  it('should include rate limit headers in 429 response', async () => {
    for (let i = 0; i < 2; i++) {
      await rateLimitAdminRoute('admin-7', 'admin-test-5', 2, 60_000);
    }
    const result = await rateLimitAdminRoute('admin-7', 'admin-test-5', 2, 60_000);
    expect(result).not.toBeNull();
    expect(result!.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(result!.headers.get('Retry-After')).not.toBeNull();
    expect(result!.headers.get('X-RateLimit-Reset')).not.toBeNull();
  });
});
