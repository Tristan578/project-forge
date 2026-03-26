import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getTokenBalance } from '@/lib/tokens/service';
import { captureException } from '@/lib/monitoring/sentry-server';

export async function GET(req: NextRequest) {
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
