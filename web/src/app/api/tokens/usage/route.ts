import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getUsageHistory } from '@/lib/tokens/service';
import { captureException } from '@/lib/monitoring/sentry-server';

export async function GET(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:tokens-usage:${id}`, max: 30, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  const parsedDays = parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10);
  const days = Number.isFinite(parsedDays) ? Math.min(parsedDays, 90) : 30;

  try {
    const usage = await getUsageHistory(mid.userId!, days);
    return NextResponse.json({ usage });
  } catch (error) {
    captureException(error, { route: '/api/tokens/usage', method: 'GET' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
