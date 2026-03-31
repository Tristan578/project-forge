import { type NextRequest, NextResponse } from 'next/server';
import { runAllHealthChecks } from '@/lib/monitoring/healthChecks';
import { rateLimitPublicRoute } from '@/lib/rateLimit';
import {
  mapHealthStatusToServiceStatus,
  deriveOverallStatus,
  type ServiceStatusEntry,
  type StatusPagePayload,
} from '@/lib/status/statusTypes';
import { MONITORED_SERVICES } from '@/lib/status/statusConfig';
import { captureException } from '@/lib/monitoring/sentry-server';

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
 * Rate limiting: 30 requests per 5 minutes per IP (same as other public routes).
 *
 * Response shape: StatusPagePayload
 * HTTP 200 — always, even when services are degraded or down.
 *             Status page consumers should inspect `overall` and `services`.
 * HTTP 429 — rate limit exceeded.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const rateLimitResult = await rateLimitPublicRoute(req, 'status');
  if (rateLimitResult) return rateLimitResult;

  try {
  const report = await runAllHealthChecks();

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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
