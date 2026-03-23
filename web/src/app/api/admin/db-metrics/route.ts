/**
 * GET /api/admin/db-metrics
 *
 * Returns database query performance metrics for the last 5-minute window.
 * Requires admin authentication.
 *
 * Response shape:
 * {
 *   avgQueryTimeMs: number,       // Average query duration (ms)
 *   slowQueryCount: number,       // Queries exceeding 500ms threshold
 *   totalQueryCount: number,      // All queries in the window
 *   top5Slowest: QueryRecord[],   // Top 5 slowest individual queries
 *   queryCountByRoute: Record<string, number>, // Per-route breakdown
 *   windowStartMs: number,        // Window start (epoch ms)
 *   windowEndMs: number,          // Window end (epoch ms)
 * }
 */
import { NextResponse } from 'next/server';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { getMetrics } from '@/lib/db/queryMonitor';
import { captureException } from '@/lib/monitoring/sentry-server';

export async function GET() {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;
  const { clerkId } = authResult.ctx;

  const adminError = assertAdmin(clerkId);
  if (adminError) return adminError;

  const rateLimitError = await rateLimitAdminRoute(clerkId, 'admin-db-metrics');
  if (rateLimitError) return rateLimitError;

  try {
    const metrics = getMetrics();
    return NextResponse.json(metrics);
  } catch (error) {
    captureException(error, { route: '/api/admin/db-metrics' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
