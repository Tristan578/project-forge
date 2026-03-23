import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getTokenBalance } from '@/lib/tokens/service';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';

export async function GET() {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const userId = authResult.ctx.user.id;
  const rl = await rateLimit(`user:tokens-balance:${userId}`, 30, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const balance = await getTokenBalance(userId);
  return NextResponse.json(balance);
}
