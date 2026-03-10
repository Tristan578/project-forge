import { NextResponse } from 'next/server';
import {
  runAllHealthChecks,
  computeCriticalStatus,
  sanitizeForPublic,
} from '@/lib/monitoring/healthChecks';

/**
 * GET /api/health
 *
 * Unauthenticated health check endpoint for monitoring and staging verification.
 * Returns application status, environment, version, and per-service health.
 * Only critical service failures (DB, Auth) trigger HTTP 503.
 * Sensitive error details are stripped from the public response.
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
      : dbService?.error?.includes('not configured')
        ? 'not_configured'
        : 'unavailable';

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
      services: sanitizeForPublic(report.services),
    },
    { status: httpStatus },
  );
}

export const dynamic = 'force-dynamic';
