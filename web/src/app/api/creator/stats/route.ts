import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getCreatorStats } from '@/lib/projects/creatorStats';
import { captureException } from '@/lib/monitoring/sentry-server';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

export const dynamic = 'force-dynamic';

/**
 * GET /api/creator/stats — the signed-in creator's published games, their play
 * counts, and token usage this cycle (#8352).
 *
 * The stats are scoped to the session's user; the route takes no user id, so
 * one creator cannot read another's numbers. Auth runs before the per-user rate
 * limit (the shared `withApiMiddleware` order), and both run before any stats
 * query.
 */
async function GET_impl(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:creator-stats:${id}`, max: 30, windowSeconds: 300 },
  });
  if (mid.error) return mid.error;

  try {
    const stats = await getCreatorStats(mid.userId!);
    return NextResponse.json(stats, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    captureException(error, { route: '/api/creator/stats', method: 'GET' });
    return redactedJson({ error: 'Creator stats are unavailable right now' }, { status: 503 });
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const GET = withEgressGuard(GET_impl);
