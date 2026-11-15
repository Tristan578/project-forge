import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getTokenBalance } from '@/lib/tokens/service';
import { captureException } from '@/lib/monitoring/sentry-server';
import { internalError } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

async function GET_impl(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:tokens-balance:${id}`, max: 30, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  try {
    const balance = await getTokenBalance(mid.userId!);
    return NextResponse.json(balance);
  } catch (error) {
    captureException(error, { route: '/api/tokens/balance', method: 'GET' });
    return internalError();
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const GET = withEgressGuard(GET_impl);
