/**
 * Tests for GET /api/cron/health-monitor
 *
 * Covers: authorization guard, healthy/degraded/down service reporting,
 * Sentry alerting on failures, response shape.
 */
vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports that pull them in
// ---------------------------------------------------------------------------

vi.mock('@/lib/monitoring/healthChecks', () => ({
  runAllHealthChecks: vi.fn(),
  computeCriticalStatus: vi.fn(),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureMessage: vi.fn(),
}));

vi.mock('@/lib/logging/logger', () => ({
  logger: {
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(secret?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (secret !== undefined) {
    headers['authorization'] = `Bearer ${secret}`;
  }
  return new NextRequest('http://localhost:3000/api/cron/health-monitor', {
    method: 'GET',
    headers,
  });
}

function makeHealthy(name: string) {
  return { name, status: 'healthy' as const, latencyMs: 10, lastChecked: '' };
}
function makeDown(name: string, error = 'connection refused') {
  return { name, status: 'down' as const, latencyMs: 0, lastChecked: '', error };
}
function makeDegraded(name: string, error = 'slow response') {
  return { name, status: 'degraded' as const, latencyMs: 2500, lastChecked: '', error };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('GET /api/cron/health-monitor', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  let runAllHealthChecks: ReturnType<typeof vi.fn>;
  let computeCriticalStatus: ReturnType<typeof vi.fn>;
  let captureMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', 'test-secret-value');

    // Re-import after resetModules so mocks are fresh
    const healthMod = await import('@/lib/monitoring/healthChecks');
    const sentryMod = await import('@/lib/monitoring/sentry-server');
    runAllHealthChecks = healthMod.runAllHealthChecks as ReturnType<typeof vi.fn>;
    computeCriticalStatus = healthMod.computeCriticalStatus as ReturnType<typeof vi.fn>;
    captureMessage = sentryMod.captureMessage as ReturnType<typeof vi.fn>;

    // Default: all services healthy
    runAllHealthChecks.mockResolvedValue({
      overall: 'healthy',
      timestamp: '2026-01-01T00:00:00.000Z',
      environment: 'test',
      version: 'abcdef12',
      services: [
        makeHealthy('Database (Neon)'),
        makeHealthy('Clerk'),
        makeHealthy('Engine CDN'),
      ],
    });
    computeCriticalStatus.mockReturnValue('healthy');

    const routeMod = await import('../route');
    GET = routeMod.GET;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------
  describe('authorization', () => {
    it('returns 401 when no Authorization header is sent', async () => {
      const res = await GET(makeReq());
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when Authorization header has wrong secret', async () => {
      const res = await GET(makeReq('wrong-secret'));
      expect(res.status).toBe(401);
    });

    it('returns 401 when CRON_SECRET env var is not set', async () => {
      vi.unstubAllEnvs();
      // CRON_SECRET is now undefined
      const res = await GET(makeReq('test-secret-value'));
      expect(res.status).toBe(401);
    });

    it('returns 200 when Authorization header matches CRON_SECRET', async () => {
      const res = await GET(makeReq('test-secret-value'));
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------
  describe('response shape', () => {
    it('returns JSON with required fields', async () => {
      const res = await GET(makeReq('test-secret-value'));
      const body = await res.json();

      expect(body).toHaveProperty('overall');
      expect(body).toHaveProperty('criticalStatus');
      expect(body).toHaveProperty('checkedAt');
      expect(body).toHaveProperty('environment');
      expect(body).toHaveProperty('version');
      expect(body).toHaveProperty('serviceCount');
      expect(body).toHaveProperty('failureCount');
      expect(body).toHaveProperty('criticalFailureCount');
      expect(body).toHaveProperty('failures');
      expect(Array.isArray(body.failures)).toBe(true);
    });

    it('reports zero failures when all services are healthy', async () => {
      const res = await GET(makeReq('test-secret-value'));
      const body = await res.json();

      expect(body.overall).toBe('healthy');
      expect(body.failureCount).toBe(0);
      expect(body.criticalFailureCount).toBe(0);
      expect(body.failures).toHaveLength(0);
    });

    it('reports correct counts when a non-critical service is down', async () => {
      runAllHealthChecks.mockResolvedValue({
        overall: 'down',
        timestamp: '2026-01-01T00:00:00.000Z',
        environment: 'test',
        version: 'abcdef12',
        services: [
          makeHealthy('Database (Neon)'),
          makeHealthy('Clerk'),
          makeDown('Engine CDN', 'CDN unreachable'),
        ],
      });
      computeCriticalStatus.mockReturnValue('healthy');

      const res = await GET(makeReq('test-secret-value'));
      const body = await res.json();

      expect(body.failureCount).toBe(1);
      expect(body.criticalFailureCount).toBe(0);
      expect(body.failures).toHaveLength(1);
      expect(body.failures[0].name).toBe('Engine CDN');
      expect(body.failures[0].status).toBe('down');
    });

    it('reports critical failures when DB is down', async () => {
      runAllHealthChecks.mockResolvedValue({
        overall: 'down',
        timestamp: '2026-01-01T00:00:00.000Z',
        environment: 'test',
        version: 'abcdef12',
        services: [
          makeDown('Database (Neon)', 'connection refused'),
          makeHealthy('Clerk'),
          makeHealthy('Engine CDN'),
        ],
      });
      computeCriticalStatus.mockReturnValue('down');

      const res = await GET(makeReq('test-secret-value'));
      const body = await res.json();

      expect(body.criticalFailureCount).toBe(1);
      expect(body.failures[0].name).toBe('Database (Neon)');
    });

    it('always returns HTTP 200 regardless of service failures', async () => {
      runAllHealthChecks.mockResolvedValue({
        overall: 'down',
        timestamp: '2026-01-01T00:00:00.000Z',
        environment: 'test',
        version: 'abcdef12',
        services: [
          makeDown('Database (Neon)', 'unreachable'),
          makeDown('Clerk', 'JWKS timeout'),
        ],
      });
      computeCriticalStatus.mockReturnValue('down');

      const res = await GET(makeReq('test-secret-value'));
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Sentry alerting
  // -------------------------------------------------------------------------
  describe('Sentry alerting', () => {
    it('does not call captureMessage when all services are healthy', async () => {
      await GET(makeReq('test-secret-value'));
      expect(captureMessage).not.toHaveBeenCalled();
    });

    it('calls captureMessage with error level for each failed service', async () => {
      runAllHealthChecks.mockResolvedValue({
        overall: 'down',
        timestamp: '2026-01-01T00:00:00.000Z',
        environment: 'test',
        version: 'abcdef12',
        services: [
          makeDown('Database (Neon)', 'connection refused'),
          makeDown('Clerk', 'timeout'),
          makeHealthy('Engine CDN'),
        ],
      });
      computeCriticalStatus.mockReturnValue('down');

      await GET(makeReq('test-secret-value'));

      expect(captureMessage).toHaveBeenCalledTimes(2);
      expect(captureMessage).toHaveBeenCalledWith(
        '[synthetic-monitor] Database (Neon) is down',
        'error',
      );
      expect(captureMessage).toHaveBeenCalledWith(
        '[synthetic-monitor] Clerk is down',
        'error',
      );
    });

    it('calls captureMessage for degraded services too', async () => {
      runAllHealthChecks.mockResolvedValue({
        overall: 'degraded',
        timestamp: '2026-01-01T00:00:00.000Z',
        environment: 'test',
        version: 'abcdef12',
        services: [
          makeHealthy('Database (Neon)'),
          makeDegraded('Clerk', 'slow JWKS'),
          makeHealthy('Engine CDN'),
        ],
      });
      computeCriticalStatus.mockReturnValue('degraded');

      await GET(makeReq('test-secret-value'));

      expect(captureMessage).toHaveBeenCalledOnce();
      expect(captureMessage).toHaveBeenCalledWith(
        '[synthetic-monitor] Clerk is degraded',
        'error',
      );
    });

    it('does not call captureMessage when request is unauthorized', async () => {
      await GET(makeReq('wrong'));
      expect(captureMessage).not.toHaveBeenCalled();
      expect(runAllHealthChecks).not.toHaveBeenCalled();
    });
  });
});
