/**
 * Tests for GET /api/cron/health-monitor
 *
 * Covers:
 * - CRON_SECRET auth enforcement (valid token, missing token, wrong token, no secret configured)
 * - All-healthy path: 200 with status "ok"
 * - DB failure: 503 with status "degraded", Sentry exception captured
 * - Redis failure: 503 with status "degraded", Sentry exception captured
 * - /api/health HTTP failure: 503 with status "degraded", Sentry exception captured
 * - Multiple failures: all appear in failureCount
 * - checkDatabase throws (unexpected error): treated as "down"
 * - No app URL configured: /api/health check skipped (treated as healthy)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockCheckDatabase = vi.fn();
const mockCheckRateLimiting = vi.fn();
const mockCaptureException = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerChild = vi.fn();

vi.mock('@/lib/monitoring/healthChecks', () => ({
  checkDatabase: (...args: unknown[]) => mockCheckDatabase(...args),
  checkRateLimiting: (...args: unknown[]) => mockCheckRateLimiting(...args),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

vi.mock('@/lib/logging/logger', () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: vi.fn(),
    child: (...args: unknown[]) => { mockLoggerChild(...args); return { info: vi.fn(), error: vi.fn(), warn: vi.fn() }; },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(opts: { token?: string; noAuth?: boolean } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (!opts.noAuth && opts.token !== undefined) {
    headers['authorization'] = `Bearer ${opts.token}`;
  }
  return new NextRequest('http://localhost/api/cron/health-monitor', { headers });
}

function healthyDb() {
  return { name: 'Database (Neon)', status: 'healthy' as const, latencyMs: 5, lastChecked: new Date().toISOString() };
}

function healthyRedis() {
  return { name: 'Rate Limiting (Upstash)', status: 'healthy' as const, latencyMs: 0, lastChecked: new Date().toISOString() };
}

function downDb(error = 'connection refused') {
  return { name: 'Database (Neon)', status: 'down' as const, latencyMs: 0, lastChecked: new Date().toISOString(), error };
}

function downRedis(error = 'UPSTASH_REDIS_REST_URL not configured') {
  return { name: 'Rate Limiting (Upstash)', status: 'down' as const, latencyMs: 0, lastChecked: new Date().toISOString(), error };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/health-monitor', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    // Default: all services healthy, no app URL so /api/health check is skipped
    mockCheckDatabase.mockResolvedValue(healthyDb());
    mockCheckRateLimiting.mockResolvedValue(healthyRedis());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  describe('CRON_SECRET auth', () => {
    it('returns 401 when CRON_SECRET is set and no authorization header is provided', async () => {
      vi.stubEnv('CRON_SECRET', 'supersecret');
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      const res = await GET(makeRequest({ noAuth: true }));
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when CRON_SECRET is set and token does not match', async () => {
      vi.stubEnv('CRON_SECRET', 'supersecret');
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      const res = await GET(makeRequest({ token: 'wrongtoken' }));
      expect(res.status).toBe(401);
    });

    it('passes when CRON_SECRET is set and token matches', async () => {
      vi.stubEnv('CRON_SECRET', 'supersecret');
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      const res = await GET(makeRequest({ token: 'supersecret' }));
      expect(res.status).toBe(200);
    });

    it('passes when CRON_SECRET is not configured (open access)', async () => {
      vi.stubEnv('CRON_SECRET', '');
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      const res = await GET(makeRequest({ noAuth: true }));
      // When CRON_SECRET is empty string it's falsy, so auth check is skipped
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // All-healthy path
  // -------------------------------------------------------------------------

  it('returns 200 with status ok when all checks pass', async () => {
    const { GET } = await import('@/app/api/cron/health-monitor/route');
    const res = await GET(makeRequest({ noAuth: true }));
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; failureCount: number; checks: unknown[] };
    expect(body.status).toBe('ok');
    expect(body.failureCount).toBe(0);
    expect(body.checks).toHaveLength(3); // /api/health + db + redis
  });

  it('does not capture Sentry exception when all checks pass', async () => {
    const { GET } = await import('@/app/api/cron/health-monitor/route');
    await GET(makeRequest({ noAuth: true }));
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('logs info when all checks pass', async () => {
    const { GET } = await import('@/app/api/cron/health-monitor/route');
    await GET(makeRequest({ noAuth: true }));
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'Synthetic health monitor passed',
      expect.objectContaining({ checkCount: 3 }),
    );
  });

  // -------------------------------------------------------------------------
  // DB failure
  // -------------------------------------------------------------------------

  it('returns 503 with status degraded when DB is down', async () => {
    mockCheckDatabase.mockResolvedValue(downDb('pg: ECONNREFUSED'));
    const { GET } = await import('@/app/api/cron/health-monitor/route');
    const res = await GET(makeRequest({ noAuth: true }));
    expect(res.status).toBe(503);
    const body = await res.json() as { status: string; failureCount: number };
    expect(body.status).toBe('degraded');
    expect(body.failureCount).toBe(1);
  });

  it('captures Sentry exception when DB is down', async () => {
    mockCheckDatabase.mockResolvedValue(downDb('pg: ECONNREFUSED'));
    const { GET } = await import('@/app/api/cron/health-monitor/route');
    await GET(makeRequest({ noAuth: true }));
    expect(mockCaptureException).toHaveBeenCalledOnce();
    const [err, ctx] = mockCaptureException.mock.calls[0] as [Error, Record<string, unknown>];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('Database (Neon)');
    expect((ctx.failures as string[]).some((f: string) => f.includes('Database (Neon)'))).toBe(true);
  });

  it('logs error when DB is down', async () => {
    mockCheckDatabase.mockResolvedValue(downDb());
    const { GET } = await import('@/app/api/cron/health-monitor/route');
    await GET(makeRequest({ noAuth: true }));
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Synthetic health monitor failure',
      expect.objectContaining({ failures: expect.any(Array) }),
    );
  });

  // -------------------------------------------------------------------------
  // Redis failure
  // -------------------------------------------------------------------------

  it('returns 503 with status degraded when Redis is down', async () => {
    mockCheckRateLimiting.mockResolvedValue(downRedis());
    const { GET } = await import('@/app/api/cron/health-monitor/route');
    const res = await GET(makeRequest({ noAuth: true }));
    expect(res.status).toBe(503);
    const body = await res.json() as { failureCount: number };
    expect(body.failureCount).toBe(1);
  });

  it('captures Sentry exception when Redis is down', async () => {
    mockCheckRateLimiting.mockResolvedValue(downRedis('no url'));
    const { GET } = await import('@/app/api/cron/health-monitor/route');
    await GET(makeRequest({ noAuth: true }));
    expect(mockCaptureException).toHaveBeenCalledOnce();
    const [_err, ctx] = mockCaptureException.mock.calls[0] as [Error, Record<string, unknown>];
    expect((ctx.failures as string[]).some((f: string) => f.includes('Rate Limiting'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Multiple failures
  // -------------------------------------------------------------------------

  it('reports both failures when both DB and Redis are down', async () => {
    mockCheckDatabase.mockResolvedValue(downDb());
    mockCheckRateLimiting.mockResolvedValue(downRedis());
    const { GET } = await import('@/app/api/cron/health-monitor/route');
    const res = await GET(makeRequest({ noAuth: true }));
    expect(res.status).toBe(503);
    const body = await res.json() as { failureCount: number };
    expect(body.failureCount).toBe(2);
    // Sentry called once with both failures in context
    expect(mockCaptureException).toHaveBeenCalledOnce();
    const [_err, ctx] = mockCaptureException.mock.calls[0] as [Error, Record<string, unknown>];
    expect((ctx.failures as string[]).length).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Unexpected throws
  // -------------------------------------------------------------------------

  it('treats thrown errors from checkDatabase as "down" and captures to Sentry', async () => {
    mockCheckDatabase.mockRejectedValue(new Error('unexpected crash'));
    const { GET } = await import('@/app/api/cron/health-monitor/route');
    const res = await GET(makeRequest({ noAuth: true }));
    expect(res.status).toBe(503);
    const body = await res.json() as { checks: Array<{ name: string; status: string }> };
    const dbCheck = body.checks.find((c) => c.name === 'Database (Neon)');
    expect(dbCheck?.status).toBe('down');
    expect(mockCaptureException).toHaveBeenCalled();
  });

  it('treats thrown errors from checkRateLimiting as "down"', async () => {
    mockCheckRateLimiting.mockRejectedValue(new Error('redis crash'));
    const { GET } = await import('@/app/api/cron/health-monitor/route');
    const res = await GET(makeRequest({ noAuth: true }));
    expect(res.status).toBe(503);
    const body = await res.json() as { checks: Array<{ name: string; status: string }> };
    const redisCheck = body.checks.find((c) => c.name === 'Rate Limiting (Upstash)');
    expect(redisCheck?.status).toBe('down');
  });

  // -------------------------------------------------------------------------
  // /api/health HTTP check
  // -------------------------------------------------------------------------

  it('skips /api/health HTTP check when no app URL is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('VERCEL_URL', '');
    const { GET } = await import('@/app/api/cron/health-monitor/route');
    const res = await GET(makeRequest({ noAuth: true }));
    // Still 200 — /api/health is treated as passing when URL unknown
    expect(res.status).toBe(200);
  });

  it('reports /api/health as down when HTTP check returns non-ok status', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:9999');
    // fetch will reject (no server on 9999)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')));
    const { GET } = await import('@/app/api/cron/health-monitor/route');
    const res = await GET(makeRequest({ noAuth: true }));
    expect(res.status).toBe(503);
    const body = await res.json() as { checks: Array<{ name: string; status: string }> };
    const healthCheck = body.checks.find((c) => c.name === '/api/health');
    expect(healthCheck?.status).toBe('down');
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  it('always includes startedAt, checks, failureCount in the response body', async () => {
    const { GET } = await import('@/app/api/cron/health-monitor/route');
    const res = await GET(makeRequest({ noAuth: true }));
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.startedAt).toBe('string');
    expect(Array.isArray(body.checks)).toBe(true);
    expect(typeof body.failureCount).toBe('number');
    expect(typeof body.status).toBe('string');
  });
});
