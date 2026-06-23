vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Verifies the route delegates its authorized run through the Sentry cron
// check-in monitor (#8818). The real no-op (no-DSN) behaviour is exercised by
// route.test.ts; here we assert the wiring: GET → withCronMonitor(slug, work).

const { mockWithCronMonitor, realMonitor } = vi.hoisted(() => ({
  mockWithCronMonitor: vi.fn(),
  realMonitor: {
    path: '/api/cron/health-monitor',
    schedule: '*/5 * * * *',
    slug: 'spawnforge-health-monitor',
  } as const,
}));

vi.mock('@/lib/monitoring/cronMonitors', () => ({
  getCronMonitor: vi.fn(() => realMonitor),
  withCronMonitor: (...args: unknown[]) => mockWithCronMonitor(...args),
}));

vi.mock('@/lib/monitoring/healthChecks', () => ({
  runAllHealthChecks: vi.fn().mockResolvedValue({
    overall: 'healthy',
    timestamp: new Date().toISOString(),
    environment: 'test',
    version: '1.0.0',
    services: [],
  }),
  computeCriticalStatus: vi.fn().mockReturnValue('healthy'),
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/billing/webhookIdempotency', () => ({
  cleanupExpired: vi.fn().mockResolvedValue(0),
}));
vi.mock('@/lib/logging/logger', () => ({
  logger: {
    child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { GET } from './route';

const CRON_SECRET = 'test-cron-secret';

function authedReq(): NextRequest {
  return new NextRequest('http://localhost:3000/api/cron/health-monitor', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

describe('GET /api/cron/health-monitor — Sentry cron monitor wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', CRON_SECRET);
    // The wrapper invokes the supplied work function and returns its result.
    mockWithCronMonitor.mockImplementation(
      (_monitor: unknown, work: () => Promise<unknown>) => work(),
    );
  });

  it('wraps the authorized run in withCronMonitor with the health-monitor entry', async () => {
    const res = await GET(authedReq());

    expect(res.status).toBe(200);
    expect(mockWithCronMonitor).toHaveBeenCalledTimes(1);
    const [monitorArg, workArg] = mockWithCronMonitor.mock.calls[0];
    expect(monitorArg).toEqual(realMonitor);
    expect(typeof workArg).toBe('function');
  });

  it('does NOT invoke the monitor for an unauthorized (401) request', async () => {
    const res = await GET(
      new NextRequest('http://localhost:3000/api/cron/health-monitor'),
    );

    expect(res.status).toBe(401);
    expect(mockWithCronMonitor).not.toHaveBeenCalled();
  });
});
