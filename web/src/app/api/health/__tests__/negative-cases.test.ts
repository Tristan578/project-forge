/**
 * Negative / error case tests for GET /api/health
 *
 * Covers: rate limiting, cache behavior, service degradation triggering
 * 503 status, and response header validation.
 */
vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetCachedHealthReport = vi.fn();
const mockPeekCachedHealthReport = vi.fn();
const mockComputeCriticalStatus = vi.fn();
const mockSanitizeForPublic = vi.fn();

vi.mock('@/lib/monitoring/healthChecks', () => ({
  getCachedHealthReport: (...args: unknown[]) => mockGetCachedHealthReport(...args),
  // The route peeks before spending fan-out budget. Defaulting to "no live
  // cache" keeps every case below on the path that actually exercises the
  // route; the fan-out budget block overrides it to cover the hit path.
  peekCachedHealthReport: (...args: unknown[]) => mockPeekCachedHealthReport(...args),
  computeCriticalStatus: (...args: unknown[]) => mockComputeCriticalStatus(...args),
  sanitizeForPublic: (...args: unknown[]) => mockSanitizeForPublic(...args),
}));

// A `vi.mock` factory replaces the WHOLE module, so every export the route
// reaches for has to be listed — an omitted one is `undefined` at the call site,
// not a pass-through to the real implementation.
const mockRateLimitPublicRoute = vi.fn();
const mockRateLimitResponse = vi.fn();
vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: (...args: unknown[]) => mockRateLimitPublicRoute(...args),
  getClientIp: () => '1.2.3.4',
  rateLimitResponse: (...args: unknown[]) => mockRateLimitResponse(...args),
}));

const mockCheckHealthFanoutBudget = vi.fn();
vi.mock('@/lib/monitoring/healthFanoutBudget', () => ({
  checkHealthFanoutBudget: (...args: unknown[]) => mockCheckHealthFanoutBudget(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(ip = '1.2.3.4'): NextRequest {
  return new NextRequest('http://localhost:3000/api/health', {
    headers: { 'x-forwarded-for': ip },
  });
}

function makeHealthReport(overrides: Record<string, unknown> = {}) {
  return {
    overall: 'healthy',
    timestamp: new Date().toISOString(),
    services: [
      { name: 'Database (Neon)', status: 'healthy', latencyMs: 5, lastChecked: new Date().toISOString() },
      { name: 'Clerk', status: 'healthy', latencyMs: 10, lastChecked: new Date().toISOString() },
    ],
    environment: 'test',
    version: '1.0.0',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/health — negative cases', () => {
  let GET: (req: NextRequest) => Promise<Response>;
  let resetHealthCache: () => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Default: no rate limit, and fan-out budget available
    mockRateLimitPublicRoute.mockResolvedValue(null);
    mockRateLimitResponse.mockImplementation((_remaining: number, resetAt: number) => {
      const retryAfter = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { 'Retry-After': String(retryAfter) },
      });
    });
    mockPeekCachedHealthReport.mockReturnValue(null);
    mockCheckHealthFanoutBudget.mockResolvedValue({
      allowed: true,
      remaining: 29,
      resetAt: Date.now() + 60_000,
    });

    // Default: healthy checks
    mockGetCachedHealthReport.mockResolvedValue(makeHealthReport());
    mockComputeCriticalStatus.mockReturnValue('healthy');
    mockSanitizeForPublic.mockImplementation((services: Array<{ status: string }>) =>
      services.map((s) => ({ ...s }))
    );

    const mod = await import('../../health/route');
    GET = mod.GET;
    resetHealthCache = mod.resetHealthCache;
    resetHealthCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------
  describe('rate limiting', () => {
    it('returns 429 when rate limit is exceeded', async () => {
      const mockResponse = new Response(
        JSON.stringify({ error: 'Too many requests. Try again in 30 seconds.' }),
        { status: 429, headers: { 'Retry-After': '30' } },
      );
      // rateLimitPublicRoute returns a response when rate limited
      mockRateLimitPublicRoute.mockResolvedValue(mockResponse);

      const res = await GET(makeReq());
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toMatch(/too many requests/i);
    });

    it('does not run health checks when rate limited', async () => {
      mockRateLimitPublicRoute.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 }),
      );

      await GET(makeReq());
      expect(mockGetCachedHealthReport).not.toHaveBeenCalled();
    });

    it('rate limits by IP address (different IPs are independent)', async () => {
      // First call from IP-A: allowed
      mockRateLimitPublicRoute.mockResolvedValue(null);
      const res1 = await GET(makeReq('10.0.0.1'));
      expect(res1.status).toBe(200);

      // Verify rate limit was called with the endpoint identifier
      expect(mockRateLimitPublicRoute).toHaveBeenCalledWith(
        expect.anything(),
        'health',
        60,
        60_000,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Fan-out budget
  // -------------------------------------------------------------------------
  describe('fan-out budget', () => {
    it('serves a live shared-cache report without spending budget', async () => {
      resetHealthCache();
      mockPeekCachedHealthReport.mockReturnValue(makeHealthReport());

      const res = await GET(makeReq());

      // The budget bounds the six OUTBOUND probes, not the act of reading a
      // report we already hold. Charging on a hit would let a warm cache burn
      // an allowance it never consumed.
      expect(res.status).toBe(200);
      expect(mockCheckHealthFanoutBudget).not.toHaveBeenCalled();
      expect(mockGetCachedHealthReport).not.toHaveBeenCalled();
    });

    it('charges the budget once the shared cache misses', async () => {
      resetHealthCache();
      mockPeekCachedHealthReport.mockReturnValue(null);

      await GET(makeReq());

      // Keyed on the caller, and shared with the /health page — two buckets
      // would not bound the fan-out, they would double it.
      expect(mockCheckHealthFanoutBudget).toHaveBeenCalledWith('1.2.3.4');
      expect(mockGetCachedHealthReport).toHaveBeenCalledTimes(1);
    });

    it('returns an honest 429 when the fan-out budget is exhausted', async () => {
      resetHealthCache();
      mockPeekCachedHealthReport.mockReturnValue(null);
      const resetAt = Date.now() + 45_000;
      mockCheckHealthFanoutBudget.mockResolvedValue({ allowed: false, remaining: 0, resetAt });

      const res = await GET(makeReq());

      expect(res.status).toBe(429);
      // Built from the budget's own numbers rather than a bare 429, so a
      // monitoring tool learns when to come back instead of hammering.
      expect(mockRateLimitResponse).toHaveBeenCalledWith(0, resetAt);
      expect(res.headers.get('Retry-After')).toBe('45');
      // And the whole point: no probes are paid for on the way out.
      expect(mockGetCachedHealthReport).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Service degradation (503)
  // -------------------------------------------------------------------------
  describe('service degradation', () => {
    it('returns 503 when critical services are down', async () => {
      resetHealthCache();
      mockComputeCriticalStatus.mockReturnValue('down');
      mockGetCachedHealthReport.mockResolvedValue(
        makeHealthReport({
          services: [
            { name: 'Database (Neon)', status: 'down', latencyMs: 0, lastChecked: new Date().toISOString(), error: 'Connection refused' },
          ],
        }),
      );

      const res = await GET(makeReq());
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe('error');
    });

    it('returns database=unavailable when DB service is down', async () => {
      resetHealthCache();
      mockComputeCriticalStatus.mockReturnValue('down');
      mockGetCachedHealthReport.mockResolvedValue(
        makeHealthReport({
          services: [
            { name: 'Database (Neon)', status: 'down', latencyMs: 0, lastChecked: new Date().toISOString() },
            { name: 'Clerk', status: 'healthy', latencyMs: 5, lastChecked: new Date().toISOString() },
          ],
        }),
      );

      const res = await GET(makeReq());
      const body = await res.json();
      expect(body.database).toBe('unavailable');
    });

    it('returns 200 when non-critical services are degraded', async () => {
      resetHealthCache();
      mockComputeCriticalStatus.mockReturnValue('degraded');
      mockGetCachedHealthReport.mockResolvedValue(
        makeHealthReport({
          services: [
            { name: 'Sentry', status: 'degraded', latencyMs: 2000, lastChecked: new Date().toISOString() },
          ],
        }),
      );

      const res = await GET(makeReq());
      // Non-critical degradation does not trigger 503
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Cache behavior
  // -------------------------------------------------------------------------
  describe('response caching', () => {
    it('returns X-Cache: MISS on first request', async () => {
      resetHealthCache();
      const res = await GET(makeReq());
      expect(res.headers.get('X-Cache')).toBe('MISS');
    });

    it('returns X-Cache: HIT on subsequent cached request', async () => {
      resetHealthCache();
      await GET(makeReq());

      // Second request should be cached
      const res2 = await GET(makeReq());
      expect(res2.headers.get('X-Cache')).toBe('HIT');
    });

    it('sets Cache-Control: public, max-age=60, s-maxage=300', async () => {
      resetHealthCache();
      const res = await GET(makeReq());
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=300');
    });

    it('does not call health checks on cached hit', async () => {
      resetHealthCache();
      await GET(makeReq());
      mockGetCachedHealthReport.mockClear();

      await GET(makeReq());
      expect(mockGetCachedHealthReport).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Error detail sanitization
  // -------------------------------------------------------------------------
  describe('error detail sanitization', () => {
    it('calls sanitizeForPublic to strip sensitive error details', async () => {
      resetHealthCache();
      const services = [
        { name: 'Database (Neon)', status: 'down', latencyMs: 0, lastChecked: new Date().toISOString(), error: 'connection string: postgres://secret@host' },
      ];
      mockGetCachedHealthReport.mockResolvedValue(makeHealthReport({ services }));
      mockComputeCriticalStatus.mockReturnValue('down');
      mockSanitizeForPublic.mockReturnValue(
        services.map((s) => ({ ...s, error: undefined })),
      );

      await GET(makeReq());
      expect(mockSanitizeForPublic).toHaveBeenCalledWith(services);
    });
  });

  // -------------------------------------------------------------------------
  // HTTP method
  // -------------------------------------------------------------------------
  describe('request method', () => {
    it('only exports GET handler (no POST)', async () => {
      const mod = await import('../../health/route');
      expect(typeof mod.GET).toBe('function');
      expect((mod as Record<string, unknown>).POST).toBeUndefined();
    });
  });
});
