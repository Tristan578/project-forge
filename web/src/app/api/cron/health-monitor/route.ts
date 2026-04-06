import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import {
  runAllHealthChecks,
  computeCriticalStatus,
  type ServiceHealth,
} from '@/lib/monitoring/healthChecks';
import { captureException } from '@/lib/monitoring/sentry-server';
import { logger } from '@/lib/logging/logger';

/**
 * GET /api/cron/health-monitor
 *
 * Runs every 5 minutes via Vercel Cron. Executes all service health checks and
 * reports any failures to Sentry as structured exceptions so on-call engineers
 * are alerted without manual polling.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` on every
 * invocation. Requests without a matching secret are rejected 401. If
 * CRON_SECRET is not configured, all requests are rejected to prevent open
 * access in production.
 *
 * HTTP status: always 200 on authorized requests — Vercel treats non-200 as a
 * cron failure and backs off. Service failures are signalled via Sentry only.
 */

function isAuthorizedCron(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;
  // Compare fixed-length HMAC digests to avoid leaking secret length
  // through the early-return on mismatched Buffer lengths.
  const hmacKey = 'spawnforge-cron-auth';
  const expectedDigest = createHmac('sha256', hmacKey).update(`Bearer ${cronSecret}`).digest();
  const actualDigest = createHmac('sha256', hmacKey).update(authHeader).digest();
  return timingSafeEqual(expectedDigest, actualDigest);
}

function reportFailuresToSentry(
  failedServices: ServiceHealth[],
  overallStatus: string,
): void {
  for (const service of failedServices) {
    const error = new Error(
      `[synthetic-monitor] ${service.name} is ${service.status}: ${service.error ?? 'no details'}`,
    );
    captureException(error, {
      source: 'cron/health-monitor',
      service: service.name,
      status: service.status,
      latencyMs: service.latencyMs,
      overallStatus,
      tags: { type: 'synthetic-monitor', service: service.name },
    });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const log = logger.child({ endpoint: 'GET /api/cron/health-monitor' });
  log.info('Synthetic health monitor starting');

  const report = await runAllHealthChecks();
  const criticalStatus = computeCriticalStatus(report.services);

  const failedServices = report.services.filter((s) => s.status !== 'healthy');
  const criticalFailures = report.services.filter(
    (s) =>
      (s.name === 'Database (Neon)' || s.name === 'Clerk') && s.status !== 'healthy',
  );

  if (failedServices.length > 0) {
    reportFailuresToSentry(failedServices, report.overall);

    // Critical failures (Database, Clerk) or any 'down' status → error
    // Non-critical degraded services → warn to reduce alert noise (#7075)
    const criticalOrDown = failedServices.filter(
      (s) => criticalFailures.some((c) => c.name === s.name) || s.status === 'down',
    );
    const nonCriticalDegraded = failedServices.filter(
      (s) => !criticalOrDown.includes(s),
    );

    if (criticalOrDown.length > 0) {
      logger.error('Synthetic health monitor detected critical failures', {
        endpoint: 'GET /api/cron/health-monitor',
        failureCount: failedServices.length,
        criticalFailureCount: criticalFailures.length,
        failures: criticalOrDown.map((s) => ({ name: s.name, status: s.status })),
      });
    }
    if (nonCriticalDegraded.length > 0) {
      logger.warn('Synthetic health monitor detected non-critical outages', {
        endpoint: 'GET /api/cron/health-monitor',
        failureCount: nonCriticalDegraded.length,
        failures: nonCriticalDegraded.map((s) => ({ name: s.name, status: s.status })),
      });
    }
  }

  const summary = {
    overall: report.overall,
    criticalStatus,
    checkedAt: report.timestamp,
    environment: report.environment,
    version: report.version,
    serviceCount: report.services.length,
    failureCount: failedServices.length,
    criticalFailureCount: criticalFailures.length,
    failures: failedServices.map((s) => ({
      name: s.name,
      status: s.status,
      latencyMs: s.latencyMs,
      error: s.error,
    })),
  };

  log.info('Synthetic health monitor complete', {
    overall: report.overall,
    criticalStatus,
    failureCount: failedServices.length,
    criticalFailureCount: criticalFailures.length,
  });

  // Always return 200 — Vercel cron considers non-200 a failure and backs off.
  // Service failures are communicated exclusively via Sentry.
  return NextResponse.json(summary, { status: 200 });
}

export const dynamic = 'force-dynamic';
// Allow up to 30s for all 9 health checks to complete
export const maxDuration = 30;
