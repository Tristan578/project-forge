import { NextResponse } from 'next/server';
import { runAllHealthChecks } from '@/lib/monitoring/healthChecks';

/**
 * GET /api/health
 *
 * Unauthenticated health check endpoint for monitoring and staging verification.
 * Returns application status, environment, version, and per-service health details.
 */
export async function GET(): Promise<NextResponse> {
  const report = await runAllHealthChecks();
  const httpStatus = report.overall === 'down' ? 503 : 200;

  // Preserve backward-compatible top-level fields alongside the new report shape
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
      // Backward-compatible fields
      status: report.overall === 'down' ? 'error' : 'ok',
      environment: report.environment,
      commit: commit.slice(0, 8),
      branch,
      database: dbStatus,
      timestamp: report.timestamp,
      // New detailed report
      overall: report.overall,
      version: report.version,
      services: report.services,
    },
    { status: httpStatus },
  );
}

export const dynamic = 'force-dynamic';
