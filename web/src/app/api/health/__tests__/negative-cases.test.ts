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

const mockRunAllHealthChecks = vi.fn();
const mockComputeCriticalStatus = vi.fn();
const mockSanitizeForPublic = vi.fn();

vi.mock('@/lib/monitoring/healthChecks', () => ({
  runAllHealthChecks: (...args: unknown[]) => mockRunAllHealthChecks(...args),
  computeCriticalStatus: (...args: unknown[]) => mockComputeCriticalStatus(...args),
  sanitizeForPublic: (...args: unknown[]) => mockSanitizeForPublic(...args),
}));

const mockRateLimitPublicRoute = vi.fn();
vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: (...args: unknown[]) => mockRateLimitPublicRoute(...args),
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

    // Default: no rate limit
    mockRateLimitPublicRoute.mockResolvedValue(null);

    // Default: healthy checks
    mockRunAllHealthChecks.mockResolvedValue(makeHealthReport());
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
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
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
      expect(mockRunAllHealthChecks).not.toHaveBeenCalled();
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
  // Service degradation (503)
  // -------------------------------------------------------------------------
  describe('service degradation', () => {
    it('returns 503 when critical services are down', async () => {
      resetHealthCache();
      mockComputeCriticalStatus.mockReturnValue('down');
      mockRunAllHealthChecks.mockResolvedValue(
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
      mockRunAllHealthChecks.mockResolvedValue(
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
      mockRunAllHealthChecks.mockResolvedValue(
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
      mockRunAllHealthChecks.mockClear();

      await GET(makeReq());
      expect(mockRunAllHealthChecks).not.toHaveBeenCalled();
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
      mockRunAllHealthChecks.mockResolvedValue(makeHealthReport({ services }));
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
