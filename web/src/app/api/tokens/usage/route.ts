import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getUsageHistory } from '@/lib/tokens/service';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';

export async function GET(req: Request) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const userId = authResult.ctx.user.id;
  const rl = await rateLimit(`user:tokens-usage:${userId}`, 30, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get('days') ?? '30', 10);

  const usage = await getUsageHistory(userId, Math.min(days, 90));
  return NextResponse.json({ usage });
}
