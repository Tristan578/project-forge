import { NextResponse } from 'next/server';
import { authenticateRequest, assertTier } from '@/lib/auth/api-auth';
import { listConfiguredProviders } from '@/lib/keys/resolver';

/** GET /api/keys — list which providers have BYOK keys configured */
export async function GET() {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const tierCheck = assertTier(authResult.ctx.user, ['hobbyist', 'creator', 'pro']);
  if (tierCheck) return tierCheck;

  const providers = await listConfiguredProviders(authResult.ctx.user.id);
  return NextResponse.json({
    providers: providers.map((p) => ({
      provider: p.provider,
      configured: true,
      createdAt: p.createdAt.toISOString(),
    })),
  });
}
