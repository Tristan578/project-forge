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
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { getMetrics } from '@/lib/db/queryMonitor';
import { captureException } from '@/lib/monitoring/sentry-server';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

async function GET_impl(req: NextRequest) {
  const mid = await withApiMiddleware(req, { requireAuth: true });
  if (mid.error) return mid.error;
  const { clerkId } = mid.authContext!;

  const adminError = assertAdmin(clerkId);
  if (adminError) return adminError;

  const rateLimitError = await rateLimitAdminRoute(clerkId, 'admin-db-metrics');
  if (rateLimitError) return rateLimitError;

  try {
    const metrics = getMetrics();
    return NextResponse.json(metrics);
  } catch (error) {
    captureException(error, { route: '/api/admin/db-metrics' });
    return redactedJson({ error: 'Internal server error' }, { status: 500 });
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const GET = withEgressGuard(GET_impl);
