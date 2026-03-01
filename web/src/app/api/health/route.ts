import { NextResponse } from 'next/server';

/**
 * GET /api/health
 *
 * Unauthenticated health check endpoint for monitoring and staging verification.
 * Returns application status, environment, version, and database connectivity.
 */
export async function GET(): Promise<NextResponse> {
  const env = process.env.NEXT_PUBLIC_ENVIRONMENT ?? process.env.NODE_ENV ?? 'unknown';
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? 'local';
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? 'unknown';

  let dbStatus: 'connected' | 'unavailable' | 'not_configured' = 'not_configured';

  if (process.env.DATABASE_URL) {
    try {
      const { neon } = await import('@neondatabase/serverless');
      const sql = neon(process.env.DATABASE_URL);
      await sql`SELECT 1`;
      dbStatus = 'connected';
    } catch {
      dbStatus = 'unavailable';
    }
  }

  return NextResponse.json({
    status: 'ok',
    environment: env,
    commit: commit.slice(0, 8),
    branch,
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
}

export const dynamic = 'force-dynamic';
