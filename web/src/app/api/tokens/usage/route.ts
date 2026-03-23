import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getUsageHistory } from '@/lib/tokens/service';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export async function GET(req: Request) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const userId = authResult.ctx.user.id;
  const rl = await rateLimit(`user:tokens-usage:${userId}`, 30, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  try {
    const url = new URL(req.url);
    const days = parseInt(url.searchParams.get('days') ?? '30', 10);

    const usage = await getUsageHistory(userId, Math.min(days, 90));
    return NextResponse.json({ usage });
  } catch (error) {
    captureException(error, { route: '/api/tokens/usage' });
    return NextResponse.json({ error: 'Failed to fetch usage history' }, { status: 500 });
  }
}
