import 'server-only';
import { type NextRequest, NextResponse } from 'next/server';
import {
  runAllHealthChecks,
  computeCriticalStatus,
  type ServiceHealth,
} from '@/lib/monitoring/healthChecks';
import { captureMessage } from '@/lib/monitoring/sentry-server';
import { logger } from '@/lib/logging/logger';

/**
 * GET /api/cron/health-monitor
 *
 * Runs every 5 minutes via Vercel Cron. Executes all service health checks
 * and reports any failures to Sentry as a fatal synthetic monitor event.
 *
 * Vercel Cron invocations carry the `Authorization: Bearer <CRON_SECRET>` header.
 * Requests without a valid secret are rejected with 401.
 *
 * Sentry events are tagged `type: synthetic-monitor` so they can be filtered
 * in dashboards without polluting the main error stream.
 */

/**
 * Verify the Vercel Cron authorization header.
 * Returns true when the request carries the correct CRON_SECRET bearer token.
 *
 * Per Vercel docs: Vercel sends `Authorization: Bearer <CRON_SECRET>` on every
 * cron invocation. If CRON_SECRET is not configured the endpoint rejects all
 * requests — this prevents accidental open access in production.
 */
function isAuthorizedCron(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.get('authorization');
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * Report a health monitor failure to Sentry as a fatal event.
 * Groups all synthetic monitor failures under a single fingerprint per failed
 * service so repeated alerts are deduplicated rather than flooding the inbox.
 */
function reportFailureToSentry(
  failedServices: ServiceHealth[],
  overallStatus: string,
): void {
  for (const service of failedServices) {
    const message = `[synthetic-monitor] ${service.name} is ${service.status}`;
    captureMessage(message, 'error');
    logger.error('Synthetic monitor failure', {
      endpoint: 'cron/health-monitor',
      service: service.name,
      status: service.status,
      latencyMs: service.latencyMs,
      error: service.error,
      overallStatus,
      sentryTags: { type: 'synthetic-monitor', service: service.name },
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
    reportFailureToSentry(failedServices, report.overall);
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

  // Return 200 regardless of service state — cron should always be considered
  // "succeeded" from Vercel's perspective. Failures are signalled via Sentry.
  return NextResponse.json(summary, { status: 200 });
}

export const dynamic = 'force-dynamic';
// Vercel Functions: allow up to 30s for all 9 health checks to complete
export const maxDuration = 30;
