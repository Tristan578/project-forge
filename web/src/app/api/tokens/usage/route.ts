import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getUsageHistory } from '@/lib/tokens/service';
import { captureException } from '@/lib/monitoring/sentry-server';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

async function GET_impl(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:tokens-usage:${id}`, max: 30, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10);

  try {
    const usage = await getUsageHistory(mid.userId!, Math.min(days, 90));
    return NextResponse.json({ usage });
  } catch (error) {
    captureException(error, { route: '/api/tokens/usage', method: 'GET' });
    return redactedJson({ error: 'Internal server error' }, { status: 500 });
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const GET = withEgressGuard(GET_impl);
