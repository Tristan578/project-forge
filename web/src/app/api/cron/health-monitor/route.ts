import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import {
  runAllHealthChecks,
  computeCriticalStatus,
  type ServiceHealth,
} from '@/lib/monitoring/healthChecks';
import { captureException } from '@/lib/monitoring/sentry-server';
import { getCronMonitor, withCronMonitor } from '@/lib/monitoring/cronMonitors';
import { logger } from '@/lib/logging/logger';
import { cleanupExpired } from '@/lib/billing/webhookIdempotency';

// Sentry cron check-in monitor for this Vercel-scheduled route (#8818). The
// non-null assertion is guarded by `cronMonitors.test.ts`, which asserts every
// vercel.json cron path has a registry entry — a missing entry fails CI.
const HEALTH_MONITOR = getCronMonitor('/api/cron/health-monitor')!;

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

/**
 * Best-effort maintenance: prune expired webhook-idempotency claim rows so
 * the table does not grow unbounded (#8637). Runs on this existing 5-minute
 * cron to avoid a dedicated route. Failures are logged but never propagate —
 * a maintenance hiccup must not register as a cron failure (which would make
 * Vercel back off the synthetic monitor).
 */
async function pruneExpiredWebhookClaims(): Promise<void> {
  try {
    const deleted = await cleanupExpired();
    if (deleted > 0) {
      logger.info('Pruned expired webhook-idempotency rows', {
        endpoint: 'GET /api/cron/health-monitor',
        deleted,
      });
    }
  } catch (error) {
    captureException(error, { source: 'cron/health-monitor', task: 'webhook-idempotency-cleanup' });
    logger.warn('Webhook-idempotency cleanup failed', {
      endpoint: 'GET /api/cron/health-monitor',
      error: error instanceof Error ? error.message : String(error),
    });
  }
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

/**
 * The actual monitored cron work, wrapped by the Sentry check-in monitor.
 * Returns the response summary; never throws for service failures (those are
 * reported via Sentry and still resolve 200). A genuine throw here (e.g. a
 * health-check infra error) propagates so the Sentry check-in is marked
 * `error` and the missed/failed monitor alert fires.
 */
async function runHealthMonitor(): Promise<NextResponse> {
  const log = logger.child({ endpoint: 'GET /api/cron/health-monitor' });
  log.info('Synthetic health monitor starting');

  // Opportunistic maintenance — prune expired webhook claims (#8637).
  await pruneExpiredWebhookClaims();

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

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Wrap the authorized cron run in a Sentry check-in monitor (#8818) so a
  // missed / errored / long run surfaces as a Sentry alert. No-ops without
  // SENTRY_DSN, so dev/CI/preview behaviour is unchanged.
  return withCronMonitor(HEALTH_MONITOR, runHealthMonitor);
}

export const dynamic = 'force-dynamic';
// Allow up to 30s for all 9 health checks to complete
export const maxDuration = 30;
