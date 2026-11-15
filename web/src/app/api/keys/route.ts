import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { assertTier } from '@/lib/auth/api-auth';
import { listConfiguredProviders } from '@/lib/keys/resolver';
import { withEgressGuard } from '@/lib/security/egressGuard';

/** GET /api/keys — list which providers have BYOK keys configured */
async function GET_impl(req: NextRequest) {
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

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const GET = withEgressGuard(GET_impl);
