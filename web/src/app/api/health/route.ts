import { NextResponse } from 'next/server';
import {
  runAllHealthChecks,
  computeCriticalStatus,
  sanitizeForPublic,
  type ServiceHealth,
} from '@/lib/monitoring/healthChecks';

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
 * GET /api/health
 *
 * Unauthenticated health check endpoint for monitoring and staging verification.
 * Returns application status, environment, version, and per-service health.
 * Only critical service failures (DB, Auth) trigger HTTP 503.
 * Sensitive error details are stripped from the public response.
 *
 * Services array reports: Clerk, Anthropic, Sentry, Cloudflare R2 and more.
 * Each entry has: { name, status: 'up'|'degraded'|'down', latencyMs, error? }
 *
 * Rate limiting: This endpoint makes real network calls (DB, Clerk, CDN).
 * In production, upstream infrastructure (Vercel Edge, Cloudflare) provides
 * basic rate limiting. For additional protection, add Upstash-based rate
 * limiting when the rate-limiting infrastructure is fully deployed.
 */
export async function GET(): Promise<NextResponse> {
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

  return NextResponse.json(
    {
      status: criticalStatus === 'down' ? 'error' : 'ok',
      environment: report.environment,
      commit: commit.slice(0, 8),
      branch,
      database: dbStatus,
      timestamp: report.timestamp,
      overall: report.overall,
      version: report.version,
      services: publicServices,
    },
    { status: httpStatus },
  );
}

export const dynamic = 'force-dynamic';
