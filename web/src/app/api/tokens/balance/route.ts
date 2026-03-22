import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getTokenBalance } from '@/lib/tokens/service';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export async function GET() {
  try {
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

<<<<<<< HEAD
  const userId = authResult.ctx.user.id;
  const rl = await rateLimit(`user:tokens-balance:${userId}`, 30, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const balance = await getTokenBalance(userId);
  return NextResponse.json(balance);
=======
    const balance = await getTokenBalance(authResult.ctx.user.id);
    return NextResponse.json(balance);
  } catch (err) {
    captureException(err, { route: '/api/tokens/balance', method: 'GET' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
>>>>>>> a35ba63e (feat(sentry): add captureException to tokens and user API routes)
}
