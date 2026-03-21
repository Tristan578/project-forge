/**
 * Tests for GET /api/cron/health-monitor
 *
 * Covers:
 * - CRON_SECRET auth (valid, missing header, wrong token, env var not set)
 * - All-healthy path: 200 with zero failures
 * - Sentry captureException called for each failed service
 * - Sentry captureException NOT called when all healthy
 * - DB down: failure captured with structured context
 * - Redis/Upstash down: failure captured
 * - Multiple failures: one captureException per failed service
 * - Degraded services also trigger captureException
 * - Response shape: required fields always present
 * - HTTP status is always 200 on authorized requests (Vercel cron contract)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that use them
// ---------------------------------------------------------------------------

const mockRunAllHealthChecks = vi.fn();
const mockComputeCriticalStatus = vi.fn();
const mockCaptureException = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerChild = vi.fn();

vi.mock('server-only', () => ({}));

vi.mock('@/lib/monitoring/healthChecks', () => ({
  runAllHealthChecks: (...args: unknown[]) => mockRunAllHealthChecks(...args),
  computeCriticalStatus: (...args: unknown[]) => mockComputeCriticalStatus(...args),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

vi.mock('@/lib/logging/logger', () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    child: (...args: unknown[]) => {
      mockLoggerChild(...args);
      return {
        info: (...a: unknown[]) => mockLoggerInfo(...a),
        error: (...a: unknown[]) => mockLoggerError(...a),
        warn: (...a: unknown[]) => mockLoggerWarn(...a),
      };
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ServiceStatus = 'healthy' | 'degraded' | 'down';

function makeService(name: string, status: ServiceStatus, error?: string) {
  return { name, status, latencyMs: status === 'healthy' ? 5 : 0, lastChecked: new Date().toISOString(), error };
}

function allHealthyReport() {
  const services = [
    makeService('Database (Neon)', 'healthy'),
    makeService('Payments (Stripe)', 'healthy'),
    makeService('Rate Limiting (Upstash)', 'healthy'),
    makeService('Engine CDN', 'healthy'),
    makeService('AI Providers', 'healthy'),
    makeService('Clerk', 'healthy'),
    makeService('Anthropic', 'healthy'),
    makeService('Sentry', 'healthy'),
    makeService('Cloudflare R2', 'healthy'),
  ];
  return {
    overall: 'healthy' as ServiceStatus,
    timestamp: new Date().toISOString(),
    services,
    environment: 'test',
    version: 'abc12345',
  };
}

function makeRequest(opts: { token?: string; noHeader?: boolean } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (!opts.noHeader) {
    headers['authorization'] = `Bearer ${opts.token ?? 'valid-secret'}`;
  }
  return new NextRequest('http://localhost/api/cron/health-monitor', { headers });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/health-monitor', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'valid-secret');
    const report = allHealthyReport();
    mockRunAllHealthChecks.mockResolvedValue(report);
    mockComputeCriticalStatus.mockReturnValue('healthy');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------

  describe('authorization', () => {
    it('returns 401 when CRON_SECRET env var is not set', async () => {
      vi.stubEnv('CRON_SECRET', '');
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      const res = await GET(makeRequest({ noHeader: true }));
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when no Authorization header is sent', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      const res = await GET(makeRequest({ noHeader: true }));
      expect(res.status).toBe(401);
    });

    it('returns 401 when Authorization header has wrong secret', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      const res = await GET(makeRequest({ token: 'wrong-secret' }));
      expect(res.status).toBe(401);
    });

    it('returns 200 when Authorization header matches CRON_SECRET', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      const res = await GET(makeRequest({ token: 'valid-secret' }));
      expect(res.status).toBe(200);
    });

    it('does not run health checks on unauthorized requests', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      await GET(makeRequest({ noHeader: true }));
      expect(mockRunAllHealthChecks).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // All-healthy path
  // -------------------------------------------------------------------------

  describe('all services healthy', () => {
    it('returns HTTP 200', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
    });

    it('returns overall=healthy and zero failures', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      const res = await GET(makeRequest());
      const body = await res.json() as { overall: string; failureCount: number };
      expect(body.overall).toBe('healthy');
      expect(body.failureCount).toBe(0);
    });

    it('does not call captureException', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      await GET(makeRequest());
      expect(mockCaptureException).not.toHaveBeenCalled();
    });

    it('does not log errors', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      await GET(makeRequest());
      expect(mockLoggerError).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Service failures trigger Sentry
  // -------------------------------------------------------------------------

  describe('DB down', () => {
    beforeEach(() => {
      const report = allHealthyReport();
      report.services[0] = makeService('Database (Neon)', 'down', 'ECONNREFUSED');
      report.overall = 'down';
      mockRunAllHealthChecks.mockResolvedValue(report);
      mockComputeCriticalStatus.mockReturnValue('down');
    });

    it('returns HTTP 200 even when DB is down (Vercel cron contract)', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
    });

    it('calls captureException with a structured Error', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      await GET(makeRequest());
      expect(mockCaptureException).toHaveBeenCalledOnce();
      const [err] = mockCaptureException.mock.calls[0] as [Error];
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('Database (Neon)');
      expect(err.message).toContain('down');
    });

    it('includes service context in captureException call', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      await GET(makeRequest());
      const [_err, ctx] = mockCaptureException.mock.calls[0] as [Error, Record<string, unknown>];
      expect(ctx.service).toBe('Database (Neon)');
      expect(ctx.status).toBe('down');
      expect(ctx.source).toBe('cron/health-monitor');
    });

    it('reports failureCount=1 in response body', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      const res = await GET(makeRequest());
      const body = await res.json() as { failureCount: number; criticalFailureCount: number };
      expect(body.failureCount).toBe(1);
      expect(body.criticalFailureCount).toBe(1);
    });

    it('logs an error', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      await GET(makeRequest());
      expect(mockLoggerError).toHaveBeenCalled();
    });
  });

  describe('Redis degraded (non-critical)', () => {
    beforeEach(() => {
      const report = allHealthyReport();
      report.services[2] = makeService('Rate Limiting (Upstash)', 'degraded', 'vars missing');
      report.overall = 'degraded';
      mockRunAllHealthChecks.mockResolvedValue(report);
      mockComputeCriticalStatus.mockReturnValue('healthy'); // Redis is not critical
    });

    it('calls captureException for degraded non-critical services too', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      await GET(makeRequest());
      expect(mockCaptureException).toHaveBeenCalledOnce();
      const [err] = mockCaptureException.mock.calls[0] as [Error];
      expect(err.message).toContain('Rate Limiting (Upstash)');
      expect(err.message).toContain('degraded');
    });

    it('reports zero criticalFailureCount when only non-critical services fail', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      const res = await GET(makeRequest());
      const body = await res.json() as { failureCount: number; criticalFailureCount: number };
      expect(body.failureCount).toBe(1);
      expect(body.criticalFailureCount).toBe(0);
    });
  });

  describe('multiple services down', () => {
    beforeEach(() => {
      const report = allHealthyReport();
      report.services[0] = makeService('Database (Neon)', 'down', 'timeout');
      report.services[5] = makeService('Clerk', 'down', 'JWKS unreachable');
      report.overall = 'down';
      mockRunAllHealthChecks.mockResolvedValue(report);
      mockComputeCriticalStatus.mockReturnValue('down');
    });

    it('calls captureException once per failed service', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      await GET(makeRequest());
      expect(mockCaptureException).toHaveBeenCalledTimes(2);
    });

    it('reports failureCount=2 and criticalFailureCount=2', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      const res = await GET(makeRequest());
      const body = await res.json() as { failureCount: number; criticalFailureCount: number };
      expect(body.failureCount).toBe(2);
      expect(body.criticalFailureCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  describe('response shape', () => {
    it('returns JSON with required fields', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      const res = await GET(makeRequest());
      const body = await res.json() as Record<string, unknown>;
      expect(typeof body.overall).toBe('string');
      expect(typeof body.criticalStatus).toBe('string');
      expect(typeof body.checkedAt).toBe('string');
      expect(typeof body.serviceCount).toBe('number');
      expect(typeof body.failureCount).toBe('number');
      expect(typeof body.criticalFailureCount).toBe('number');
      expect(Array.isArray(body.failures)).toBe(true);
    });

    it('always returns HTTP 200 regardless of service failures', async () => {
      const report = allHealthyReport();
      report.services[0] = makeService('Database (Neon)', 'down', 'oops');
      report.overall = 'down';
      mockRunAllHealthChecks.mockResolvedValue(report);
      mockComputeCriticalStatus.mockReturnValue('down');

      const { GET } = await import('@/app/api/cron/health-monitor/route');
      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
    });

    it('includes failures array with name/status/latencyMs/error for each failed service', async () => {
      const report = allHealthyReport();
      report.services[0] = makeService('Database (Neon)', 'down', 'ECONNREFUSED');
      report.overall = 'down';
      mockRunAllHealthChecks.mockResolvedValue(report);
      mockComputeCriticalStatus.mockReturnValue('down');

      const { GET } = await import('@/app/api/cron/health-monitor/route');
      const res = await GET(makeRequest());
      const body = await res.json() as { failures: Array<{ name: string; status: string; latencyMs: number; error: string }> };
      expect(body.failures).toHaveLength(1);
      expect(body.failures[0].name).toBe('Database (Neon)');
      expect(body.failures[0].status).toBe('down');
      expect(body.failures[0].error).toBe('ECONNREFUSED');
    });

    it('reports zero failures when all services are healthy', async () => {
      const { GET } = await import('@/app/api/cron/health-monitor/route');
      const res = await GET(makeRequest());
      const body = await res.json() as { failures: unknown[] };
      expect(body.failures).toHaveLength(0);
    });
  });
});
