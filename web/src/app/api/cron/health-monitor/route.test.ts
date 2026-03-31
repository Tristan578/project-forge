vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { runAllHealthChecks, computeCriticalStatus } from '@/lib/monitoring/healthChecks';
import { captureException } from '@/lib/monitoring/sentry-server';

vi.mock('@/lib/monitoring/healthChecks');
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

const { mockLoggerError, mockLoggerWarn } = vi.hoisted(() => ({
  mockLoggerError: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock('@/lib/logging/logger', () => ({
  logger: {
    child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
    error: mockLoggerError,
    warn: mockLoggerWarn,
  },
}));

const CRON_SECRET = 'test-cron-secret';

function makeReq(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader) headers.authorization = authHeader;
  return new NextRequest('http://localhost:3000/api/cron/health-monitor', { headers });
}

describe('GET /api/cron/health-monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', CRON_SECRET);
    vi.mocked(runAllHealthChecks).mockResolvedValue({
      overall: 'healthy',
      timestamp: new Date().toISOString(),
      environment: 'test',
      version: '1.0.0',
      services: [
        { name: 'Database (Neon)', status: 'healthy', latencyMs: 10, lastChecked: new Date().toISOString() },
        { name: 'Clerk', status: 'healthy', latencyMs: 20, lastChecked: new Date().toISOString() },
      ],
    });
    vi.mocked(computeCriticalStatus).mockReturnValue('healthy');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 without authorization header', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong secret', async () => {
    const res = await GET(makeReq('Bearer wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('returns 401 when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = await GET(makeReq(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(401);
  });

  it('returns 200 with health summary on success', async () => {
    const res = await GET(makeReq(`Bearer ${CRON_SECRET}`));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.overall).toBe('healthy');
    expect(data.failureCount).toBe(0);
  });

  it('reports failed services to Sentry', async () => {
    vi.mocked(runAllHealthChecks).mockResolvedValue({
      overall: 'degraded',
      timestamp: new Date().toISOString(),
      environment: 'test',
      version: '1.0.0',
      services: [
        { name: 'Database (Neon)', status: 'healthy', latencyMs: 10, lastChecked: new Date().toISOString() },
        { name: 'Upstash Redis', status: 'degraded', latencyMs: 500, lastChecked: new Date().toISOString(), error: 'Slow' },
      ],
    });
    vi.mocked(computeCriticalStatus).mockReturnValue('healthy');

    const res = await GET(makeReq(`Bearer ${CRON_SECRET}`));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.failureCount).toBe(1);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('still returns 200 even when services fail (Vercel cron requirement)', async () => {
    vi.mocked(runAllHealthChecks).mockResolvedValue({
      overall: 'down',
      timestamp: new Date().toISOString(),
      environment: 'test',
      version: '1.0.0',
      services: [
        { name: 'Database (Neon)', status: 'down', latencyMs: 0, lastChecked: new Date().toISOString(), error: 'Connection refused' },
        { name: 'Clerk', status: 'down', latencyMs: 0, lastChecked: new Date().toISOString(), error: 'Timeout' },
      ],
    });
    vi.mocked(computeCriticalStatus).mockReturnValue('down');

    const res = await GET(makeReq(`Bearer ${CRON_SECRET}`));
    // Always 200 — Vercel treats non-200 as cron failure and backs off
    expect(res.status).toBe(200);
    expect(captureException).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Regression: #7075 — non-critical degraded services log at warn, not error
  // -------------------------------------------------------------------------

  it('logs non-critical degraded service at warn level, not error (regression #7075)', async () => {
    vi.mocked(runAllHealthChecks).mockResolvedValue({
      overall: 'degraded',
      timestamp: new Date().toISOString(),
      environment: 'test',
      version: '1.0.0',
      services: [
        { name: 'Database (Neon)', status: 'healthy', latencyMs: 10, lastChecked: new Date().toISOString() },
        { name: 'Clerk', status: 'healthy', latencyMs: 10, lastChecked: new Date().toISOString() },
        { name: 'Rate Limiting (Upstash)', status: 'degraded', latencyMs: 0, lastChecked: new Date().toISOString(), error: 'vars missing' },
      ],
    });
    vi.mocked(computeCriticalStatus).mockReturnValue('healthy');

    await GET(makeReq(`Bearer ${CRON_SECRET}`));

    // Non-critical degraded → warn, not error
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('non-critical'),
      expect.objectContaining({ failureCount: 1 }),
    );
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('logs critical down service at error level (regression #7075)', async () => {
    vi.mocked(runAllHealthChecks).mockResolvedValue({
      overall: 'down',
      timestamp: new Date().toISOString(),
      environment: 'test',
      version: '1.0.0',
      services: [
        { name: 'Database (Neon)', status: 'down', latencyMs: 0, lastChecked: new Date().toISOString(), error: 'timeout' },
        { name: 'Clerk', status: 'healthy', latencyMs: 10, lastChecked: new Date().toISOString() },
      ],
    });
    vi.mocked(computeCriticalStatus).mockReturnValue('down');

    await GET(makeReq(`Bearer ${CRON_SECRET}`));

    // Critical failure → error
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining('critical'),
      expect.objectContaining({ criticalFailureCount: 1 }),
    );
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('logs error for critical AND warn for non-critical when both fail (regression #7075)', async () => {
    vi.mocked(runAllHealthChecks).mockResolvedValue({
      overall: 'down',
      timestamp: new Date().toISOString(),
      environment: 'test',
      version: '1.0.0',
      services: [
        { name: 'Database (Neon)', status: 'down', latencyMs: 0, lastChecked: new Date().toISOString(), error: 'timeout' },
        { name: 'Rate Limiting (Upstash)', status: 'degraded', latencyMs: 0, lastChecked: new Date().toISOString(), error: 'slow' },
      ],
    });
    vi.mocked(computeCriticalStatus).mockReturnValue('down');

    await GET(makeReq(`Bearer ${CRON_SECRET}`));

    expect(mockLoggerError).toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalled();
  });
});
