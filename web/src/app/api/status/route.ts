import { type NextRequest, NextResponse } from 'next/server';
import {
  getCachedHealthReport,
  peekCachedHealthReport,
} from '@/lib/monitoring/healthChecks';
import { checkHealthFanoutBudget } from '@/lib/monitoring/healthFanoutBudget';
import { getClientIp, rateLimitPublicRoute, rateLimitResponse } from '@/lib/rateLimit';
import {
  mapHealthStatusToServiceStatus,
  deriveOverallStatus,
  type ServiceStatusEntry,
  type StatusPagePayload,
} from '@/lib/status/statusTypes';
import { MONITORED_SERVICES } from '@/lib/status/statusConfig';
import { captureException } from '@/lib/monitoring/sentry-server';
import { redactedJson } from '@/lib/api/errors';

/**
 * GET /api/status
 *
 * Public, unauthenticated endpoint that returns the current status of all
 * SpawnForge services in a format suitable for a status page.
 *
 * This endpoint wraps the internal health check system and maps results
 * to public status vocabulary: operational / degraded / outage.
 *
 * Services not present in the internal health report are omitted from the
 * response rather than reported as unknown.
 *
 * Two separate bounds apply, because there are two separate costs:
 *   - `rateLimitPublicRoute()` — raw request volume, 30 per 5 minutes per IP,
 *     the same allowance every other public route gets.
 *   - `checkHealthFanoutBudget()` — the five outbound probes a cold report
 *     costs, shared with `/api/health` and the `/health` page and charged only
 *     on a cache miss.
 *
 * Response shape: StatusPagePayload
 * HTTP 200 — always, even when services are degraded or down.
 *             Status page consumers should inspect `overall` and `services`.
 * HTTP 429 — request volume or fan-out budget exceeded.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const rateLimitResult = await rateLimitPublicRoute(req, 'status');
  if (rateLimitResult) return rateLimitResult;

  try {
  // Shared cache + in-flight dedup: this route is public and unauthenticated,
  // so a distributed burst would otherwise fan out to five outbound probes
  // (Neon, engine CDN, Clerk, chat backend, Upstash) per request. The cache alone is NOT a
  // bound — its state is per-lambda-instance, so it bounds one instance rather
  // than the aggregate. The bound is the shared fan-out budget below, which is
  // charged only after a peek miss: a report we already hold costs nothing to
  // serve and must not spend an allowance it never consumed.
  //
  // Over budget this route returns an honest 429 rather than degrading, matching
  // /api/health. The `/health` page degrades instead, because a status page that
  // goes dark under load has failed at its one job; a machine consumer is better
  // served by being told when to come back.
  let report = peekCachedHealthReport();
  if (report === null) {
    const budget = await checkHealthFanoutBudget(getClientIp(req));
    if (!budget.allowed) return rateLimitResponse(budget.remaining, budget.resetAt);
    report = await getCachedHealthReport();
  }

  // Build a lookup map from health check name → health result for O(1) access
  const healthByName = new Map(report.services.map((s) => [s.name, s]));

  const serviceEntries: ServiceStatusEntry[] = MONITORED_SERVICES.flatMap((config) => {
    const health = healthByName.get(config.healthCheckName);
    if (!health) {
      // Health check not present in report — skip rather than invent a status
      return [];
    }
    const entry: ServiceStatusEntry = {
      id: config.id,
      name: config.displayName,
      status: mapHealthStatusToServiceStatus(health.status),
      lastCheckedAt: health.lastChecked,
      latencyMs: health.latencyMs,
      critical: config.critical,
    };
    return [entry];
  });

  const criticalIds = new Set(
    MONITORED_SERVICES.filter((c) => c.critical).map((c) => c.id),
  );
  const overall = deriveOverallStatus(serviceEntries, criticalIds);

  const payload: StatusPagePayload = {
    generatedAt: report.timestamp,
    overall,
    services: serviceEntries,
    // Active incidents are managed externally (e.g. via a status page service
    // or a manual process). This field is always empty in automated responses
    // because incident data is not stored in the health check system.
    activeIncidents: [],
  };

  return NextResponse.json(payload, {
      status: 200,
      headers: {
        // Allow CDN / edge caching for up to 30 seconds
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    captureException(error, { route: '/api/status' });
    return redactedJson({ error: 'Internal server error' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
