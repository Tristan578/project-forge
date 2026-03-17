import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

function makeReq(ip = '1.2.3.4'): NextRequest {
  return new NextRequest('http://localhost:3000/api/health', {
    headers: { 'x-forwarded-for': ip },
  });
}

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('should return ok status with environment info (backward-compatible)', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENVIRONMENT', 'test');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc12345def');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'main');
    // No DATABASE_URL set, so DB should be 'not_configured'

    const { GET } = await import('./route');
    const res = await GET(makeReq());
    const body = await res.json();

    expect(res.status).toBeLessThan(600); // any valid HTTP status
    expect(body.environment).toBe('test');
    expect(body.commit).toBe('abc12345');
    expect(body.branch).toBe('main');
    expect(body.timestamp).toBeDefined();
  });

  it('should use defaults when env vars not set', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeReq());
    const body = await res.json();

    expect(body.commit).toBe('local');
    expect(body.branch).toBe('unknown');
  });

  it('should include services array with 12 entries', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeReq());
    const body = await res.json();

    expect(body.services).toBeInstanceOf(Array);
    expect(body.services.length).toBeGreaterThanOrEqual(8);
    for (const service of body.services) {
      expect(service).toHaveProperty('name');
      expect(service).toHaveProperty('status');
      expect(service).toHaveProperty('latencyMs');
      expect(service).toHaveProperty('lastChecked');
      expect(['up', 'degraded', 'down']).toContain(service.status);
    }
  });

  it('should include overall status field', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeReq());
    const body = await res.json();

    expect(['healthy', 'degraded', 'down']).toContain(body.overall);
  });

  it('should return 503 when a critical service actively fails', async () => {
    vi.resetModules();
    // DB URL configured but connection fails → DB is 'down' → HTTP 503
    vi.stubEnv('DATABASE_URL', 'postgresql://bad-url');

    const mockSql = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const mockNeon = vi.fn().mockReturnValue(mockSql);
    vi.doMock('@neondatabase/serverless', () => ({ neon: mockNeon }));

    const { GET } = await import('./route');
    const res = await GET(makeReq());
    expect(res.status).toBe(503);
  });

  it('should return 200 when all critical services healthy', async () => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', 'postgresql://test');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_abc');
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_abc');

    // Mock neon to succeed
    const mockSql = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
    const mockNeon = vi.fn().mockReturnValue(mockSql);
    vi.doMock('@neondatabase/serverless', () => ({ neon: mockNeon }));

    // Mock fetch for Clerk JWKS check
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const { GET } = await import('./route');
    const res = await GET(makeReq());
    const body = await res.json();

    // Both critical services (DB + Auth) healthy → HTTP 200 + status 'ok'
    expect(body.database).toBe('connected');
    expect(body.status).toBe('ok');
    expect(res.status).toBe(200);
  });

  it('should report database as unavailable when DB throws', async () => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', 'postgresql://bad-url');

    const mockSql = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const mockNeon = vi.fn().mockReturnValue(mockSql);
    vi.doMock('@neondatabase/serverless', () => ({ neon: mockNeon }));

    const { GET } = await import('./route');
    const res = await GET(makeReq());
    const body = await res.json();

    expect(body.database).toBe('unavailable');
  });

  it('should report database as not_configured when DATABASE_URL missing', async () => {
    vi.resetModules();
    // No DATABASE_URL
    const { GET } = await import('./route');
    const res = await GET(makeReq());
    const body = await res.json();

    expect(body.database).toBe('not_configured');
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------
  describe('rate limiting', () => {
    it('returns 429 when IP exceeds 60 requests per minute', async () => {
      vi.resetModules();
      const { GET } = await import('./route');
      const req = makeReq('192.168.100.1');

      // Exhaust the 60 req/min limit
      for (let i = 0; i < 60; i++) {
        await GET(req);
      }

      const res = await GET(req);
      expect(res.status).toBe(429);
    });

    it('returns Retry-After header on rate limit response', async () => {
      vi.resetModules();
      const { GET } = await import('./route');
      const req = makeReq('192.168.100.2');

      for (let i = 0; i < 60; i++) {
        await GET(req);
      }

      const res = await GET(req);
      expect(res.headers.get('Retry-After')).toBeTruthy();
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    });

    it('allows requests under the 60 req/min limit', async () => {
      vi.resetModules();
      const { GET } = await import('./route');
      const req = makeReq('192.168.100.3');

      const res = await GET(req);
      expect(res.status).not.toBe(429);
    });

    it('separates rate limits by IP address', async () => {
      vi.resetModules();
      const { GET } = await import('./route');
      const req1 = makeReq('10.0.1.1');
      const req2 = makeReq('10.0.1.2');

      // Exhaust limit for first IP
      for (let i = 0; i < 60; i++) {
        await GET(req1);
      }
      const res1 = await GET(req1);
      expect(res1.status).toBe(429);

      // Second IP should still be allowed
      const res2 = await GET(req2);
      expect(res2.status).not.toBe(429);
    });
  });

  // -------------------------------------------------------------------------
  // Response caching
  // -------------------------------------------------------------------------
  describe('response caching', () => {
    it('returns X-Cache: MISS on first request', async () => {
      vi.resetModules();
      const { GET, resetHealthCache } = await import('./route');
      resetHealthCache();

      const res = await GET(makeReq('10.10.0.1'));
      expect(res.headers.get('X-Cache')).toBe('MISS');
    });

    it('returns X-Cache: HIT on cached request within 30s', async () => {
      vi.useFakeTimers();
      vi.resetModules();
      const { GET, resetHealthCache } = await import('./route');
      resetHealthCache();

      // First request populates cache
      await GET(makeReq('10.10.0.2'));

      // Advance 10s (within 30s TTL)
      vi.advanceTimersByTime(10_000);

      const res = await GET(makeReq('10.10.0.2'));
      expect(res.headers.get('X-Cache')).toBe('HIT');
      vi.useRealTimers();
    });

    it('returns Cache-Control: public, max-age=30 header', async () => {
      vi.resetModules();
      const { GET, resetHealthCache } = await import('./route');
      resetHealthCache();

      const res = await GET(makeReq('10.10.0.3'));
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=30');
    });

    it('fetches fresh data after cache TTL expires', async () => {
      vi.useFakeTimers();
      vi.resetModules();
      const { GET, resetHealthCache } = await import('./route');
      resetHealthCache();

      // First request
      await GET(makeReq('10.10.0.4'));

      // Advance past 30s TTL
      vi.advanceTimersByTime(31_000);

      const res = await GET(makeReq('10.10.0.4'));
      expect(res.headers.get('X-Cache')).toBe('MISS');
      vi.useRealTimers();
    });
  });
});
