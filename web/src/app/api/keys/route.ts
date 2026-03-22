import { NextResponse } from 'next/server';
import { authenticateRequest, assertTier } from '@/lib/auth/api-auth';
import { listConfiguredProviders } from '@/lib/keys/resolver';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

/** GET /api/keys — list which providers have BYOK keys configured */
export async function GET() {
  try {
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

<<<<<<< HEAD
  const rl = await rateLimit(`user:keys-list:${authResult.ctx.user.id}`, 30, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const tierCheck = assertTier(authResult.ctx.user, ['hobbyist', 'creator', 'pro']);
  if (tierCheck) return tierCheck;
=======
    const tierCheck = assertTier(authResult.ctx.user, ['hobbyist', 'creator', 'pro']);
    if (tierCheck) return tierCheck;
>>>>>>> d3c18920 (Add Sentry captureException to keys, jobs, and marketplace asset routes (batch 4))

    const providers = await listConfiguredProviders(authResult.ctx.user.id);
    return NextResponse.json({
      providers: providers.map((p) => ({
        provider: p.provider,
        configured: true,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    captureException(err, { route: '/api/keys', method: 'GET' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
