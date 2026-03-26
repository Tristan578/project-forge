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
vi.mock('@/lib/logging/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn() }), error: vi.fn() },
}));

const CRON_SECRET = 'test-cron-secret';

function makeReq(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader) headers.authorization = authHeader;
  return new NextRequest('http://localhost:3000/api/cron/health-monitor', { headers });
}

describe('GET /api/cron/health-monitor', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, CRON_SECRET };
    vi.mocked(runAllHealthChecks).mockResolvedValue({
      overall: 'ok',
      timestamp: new Date().toISOString(),
      environment: 'test',
      version: '1.0.0',
      services: [
        { name: 'Database (Neon)', status: 'healthy', latencyMs: 10 },
        { name: 'Clerk', status: 'healthy', latencyMs: 20 },
      ],
    });
    vi.mocked(computeCriticalStatus).mockReturnValue('ok');
  });

  afterEach(() => {
    process.env = originalEnv;
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
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(401);
  });

  it('returns 200 with health summary on success', async () => {
    const res = await GET(makeReq(`Bearer ${CRON_SECRET}`));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.overall).toBe('ok');
    expect(data.failureCount).toBe(0);
  });

  it('reports failed services to Sentry', async () => {
    vi.mocked(runAllHealthChecks).mockResolvedValue({
      overall: 'degraded',
      timestamp: new Date().toISOString(),
      environment: 'test',
      version: '1.0.0',
      services: [
        { name: 'Database (Neon)', status: 'healthy', latencyMs: 10 },
        { name: 'Upstash Redis', status: 'degraded', latencyMs: 500, error: 'Slow' },
      ],
    });
    vi.mocked(computeCriticalStatus).mockReturnValue('ok');

    const res = await GET(makeReq(`Bearer ${CRON_SECRET}`));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.failureCount).toBe(1);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('still returns 200 even when services fail (Vercel cron requirement)', async () => {
    vi.mocked(runAllHealthChecks).mockResolvedValue({
      overall: 'error',
      timestamp: new Date().toISOString(),
      environment: 'test',
      version: '1.0.0',
      services: [
        { name: 'Database (Neon)', status: 'down', latencyMs: 0, error: 'Connection refused' },
        { name: 'Clerk', status: 'down', latencyMs: 0, error: 'Timeout' },
      ],
    });
    vi.mocked(computeCriticalStatus).mockReturnValue('down');

    const res = await GET(makeReq(`Bearer ${CRON_SECRET}`));
    // Always 200 — Vercel treats non-200 as cron failure and backs off
    expect(res.status).toBe(200);
    expect(captureException).toHaveBeenCalledTimes(2);
  });
});
