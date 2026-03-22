import { NextRequest, NextResponse } from 'next/server';
import {
  runAllHealthChecks,
  computeCriticalStatus,
  sanitizeForPublic,
  type ServiceHealth,
} from '@/lib/monitoring/healthChecks';
import { rateLimitPublicRoute } from '@/lib/rateLimit';
import { logger } from '@/lib/logging/logger';

/** Public status vocabulary — 'healthy' is remapped to 'up'. */
type PublicStatus = 'up' | 'degraded' | 'down';
type PublicServiceHealth = Omit<ServiceHealth, 'status'> & { status: PublicStatus };

/**
 * Normalize internal ServiceStatus to the public API contract.
 * Internally we use 'healthy', externally we expose 'up' for consistency
 * with standard uptime monitoring conventions.
 */
function normalizeStatus(s: ServiceHealth): PublicServiceHealth {
  const publicStatus: PublicStatus = s.status === 'healthy' ? 'up' : s.status;
  return { ...s, status: publicStatus };
}

/**
 * Module-level response cache to reduce downstream service calls.
 * Health checks make 8 concurrent network requests; caching for 30s
 * reduces amplification factor when monitoring tools poll frequently.
 */
interface CachedReport {
  body: Record<string, unknown>;
  httpStatus: number;
  timestamp: number;
}

let cachedReport: CachedReport | null = null;
const CACHE_TTL_MS = 30_000;

/** Exposed for testing — resets the module-level cache. */
export function resetHealthCache(): void {
  cachedReport = null;
}

/**
 * GET /api/health
 *
 * Unauthenticated health check endpoint for monitoring and staging verification.
 * Returns application status, environment, version, and per-service health.
 * Only critical service failures (DB, Auth) trigger HTTP 503.
 * Sensitive error details are stripped from the public response.
 *
 * Rate limiting: 60 requests per minute per IP. Cached for 30 seconds to
 * reduce downstream amplification (1 request → 8 service checks).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // Rate limit: 60 req/min per IP (generous for monitoring tools, blocks hammering)
  const limited = await rateLimitPublicRoute(req, 'health', 60, 60_000);
  if (limited) return limited;

  // Return cached result if still fresh
  const now = Date.now();
  if (cachedReport !== null && now - cachedReport.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cachedReport.body, {
      status: cachedReport.httpStatus,
      headers: {
        'Cache-Control': 'public, max-age=30',
        'X-Cache': 'HIT',
      },
    });
  }

  const report = await runAllHealthChecks();
  const criticalStatus = computeCriticalStatus(report.services);
  const httpStatus = criticalStatus === 'down' ? 503 : 200;

  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? 'local';
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? 'unknown';

  const dbService = report.services.find((s) => s.name === 'Database (Neon)');
  const dbStatus =
    dbService?.status === 'healthy'
      ? 'connected'
      : dbService?.status === 'degraded'
        ? 'not_configured'
        : 'unavailable';

  const publicServices = sanitizeForPublic(report.services).map(normalizeStatus);

  // Log degraded or down health to aid incident response
  const allDegradedServices = report.services
    .filter((s) => s.status !== 'healthy')
    .map((s) => ({ name: s.name, status: s.status }));
  if (criticalStatus !== 'healthy') {
    logger.warn('Health check degraded (critical services affected)', {
      endpoint: 'GET /api/health',
      criticalStatus,
      degradedServices: allDegradedServices,
    });
  } else if (allDegradedServices.length > 0) {
    // Non-critical services are degraded — log for observability even though HTTP 200 is returned
    logger.warn('Health check degraded (non-critical services)', {
      endpoint: 'GET /api/health',
      criticalStatus,
      degradedServices: allDegradedServices,
    });
  }

  const body = {
    status: criticalStatus === 'down' ? 'error' : 'ok',
    environment: report.environment,
    commit: commit.slice(0, 8),
    branch,
    database: dbStatus,
    timestamp: report.timestamp,
    overall: report.overall,
    version: report.version,
    services: publicServices,
  };

  // Cache the fresh result
  cachedReport = { body, httpStatus, timestamp: now };

  return NextResponse.json(body, {
    status: httpStatus,
    headers: {
      'Cache-Control': 'public, max-age=30',
      'X-Cache': 'MISS',
    },
  });
}

export const dynamic = 'force-dynamic';
