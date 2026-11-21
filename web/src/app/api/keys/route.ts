import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { assertTier } from '@/lib/auth/api-auth';
import { listConfiguredProviders } from '@/lib/keys/resolver';

/** GET /api/keys — list which providers have BYOK keys configured */
export async function GET(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:keys-list:${id}`, max: 30, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  const tierCheck = assertTier(mid.authContext!.user, ['hobbyist', 'creator', 'pro']);
  if (tierCheck) return tierCheck;

  const providers = await listConfiguredProviders(mid.userId!);
  return NextResponse.json({
    providers: providers.map((p) => ({
      provider: p.provider,
      configured: true,
      createdAt: p.createdAt.toISOString(),
    })),
  });
}
