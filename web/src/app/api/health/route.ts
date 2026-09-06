/**
 * GET /api/health — service health endpoint.
 *
 * Runs 10 checks (DB, Payments, Rate limiting, Engine CDN, AI providers, Clerk,
 * chat backend, Sentry, R2, generation factory), five of which make an outbound
 * network call — see `runAllHealthChecks()` for which.
 * Only DB and Clerk failures produce HTTP 503 — all other services degrade gracefully.
 * Sensitive details are stripped from the public response; internal details are logged.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getCachedHealthReport,
  peekCachedHealthReport,
  computeCriticalStatus,
  sanitizeForPublic,
  type ServiceHealth,
  type HealthReport,
} from '@/lib/monitoring/healthChecks';
import { checkHealthFanoutBudget } from '@/lib/monitoring/healthFanoutBudget';
import { getClientIp, rateLimitPublicRoute, rateLimitResponse } from '@/lib/rateLimit';
import { logger } from '@/lib/logging/logger';
import { captureException } from '@/lib/monitoring/sentry-server';
import { HEALTH_CACHE_TTL_MS } from '@/lib/config/timeouts';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

/**
 * Public status vocabulary for EACH SERVICE — 'healthy' is remapped to 'up'.
 * The top-level `overall` field is deliberately NOT remapped; see the comment
 * where it is assigned in the response body inside `GET` below.
 */
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
 * Module-level cache of the fully-shaped RESPONSE (body + HTTP status), which
 * is a layer above the shared report cache inside `getCachedHealthReport()`.
 * This one saves the normalize/sanitize/log work on a hit; that one saves the
 * five outbound probes and is shared with every other health-reading surface.
 *
 * Neither is a rate limit — both are per-lambda-instance, so they bound one
 * instance rather than the aggregate. The two bounds live in `GET` below:
 * `rateLimitPublicRoute()` on raw request volume, and the shared fan-out
 * budget on the outbound probes specifically.
 */
interface CachedReport {
  body: Record<string, unknown>;
  httpStatus: number;
  timestamp: number;
}

let cachedReport: CachedReport | null = null;
const CACHE_TTL_MS = HEALTH_CACHE_TTL_MS;

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
 * Two distinct bounds, because there are two distinct costs:
 *
 * 1. Raw request volume against a public JSON endpoint — 60 req/min per IP via
 *    `rateLimitPublicRoute()`, in front of everything including the caches.
 * 2. The outbound fan-out (1 uncached request → 5 outbound probes) — charged to
 *    a budget SHARED with the `/health` page (`checkHealthFanoutBudget()`), and
 *    consumed only after both caches miss, since a cached report costs nothing
 *    to serve. Giving each surface its own bucket would not bound the fan-out,
 *    it would double it.
 */
async function GET_impl(req: NextRequest): Promise<NextResponse> {
  // Rate limit: 60 req/min per IP (generous for monitoring tools, blocks hammering)
  const limited = await rateLimitPublicRoute(req, 'health', 60, 60_000);
  if (limited) return limited;

  try {
  // Return cached result if still fresh
  const now = Date.now();
  if (cachedReport !== null && now - cachedReport.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cachedReport.body, {
      status: cachedReport.httpStatus,
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=300',
        'X-Cache': 'HIT',
      },
    });
  }

  // Shared with /api/status and the /health page, and in-flight deduped, so N
  // concurrent cold requests cost one fan-out rather than N. A live cached
  // report is free to serve, so it must not spend fan-out budget; only a miss
  // — the caller that would actually pay for the five probes — is charged.
  let report: HealthReport | null = peekCachedHealthReport();
  if (report === null) {
    const budget = await checkHealthFanoutBudget(getClientIp(req));
    if (!budget.allowed) return rateLimitResponse(budget.remaining, budget.resetAt);
    report = await getCachedHealthReport();
  }
  const criticalStatus = computeCriticalStatus(report.services);
  const httpStatus = criticalStatus === 'down' ? 503 : 200;

  // Commit SHA prefix is acceptable to expose for build identification, but the
  // full git branch ref (VERCEL_GIT_COMMIT_REF) leaks internal branch naming and
  // in-flight feature work to anyone hitting this unauthenticated endpoint, so it
  // is deliberately omitted from the public payload (#8648).
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? 'local';

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
    database: dbStatus,
    timestamp: report.timestamp,
    // NOT normalized: `overall` keeps the internal vocabulary ('healthy' |
    // 'degraded' | 'down') while each entry in `services` is remapped to 'up'.
    // The asymmetry is the shipped contract — external consumers already read
    // it this way — so a client consuming this payload must translate the
    // per-service half and only that half (see `fromWireReport()` in
    // HealthDashboard.tsx, which exists because this was missed once).
    overall: report.overall,
    version: report.version,
    services: publicServices,
  };

  // Cache the fresh result
  cachedReport = { body, httpStatus, timestamp: now };

  return NextResponse.json(body, {
      status: httpStatus,
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=300',
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    captureException(error, { route: '/api/health' });
    return redactedJson({ error: 'Internal server error' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const GET = withEgressGuard(GET_impl);
