import { NextResponse } from 'next/server';
import { authenticateRequest, assertTier } from '@/lib/auth/api-auth';
import { storeProviderKey, deleteProviderKey } from '@/lib/keys/resolver';
import type { Provider } from '@/lib/db/schema';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { parseJsonBody, requireString, requireOneOf } from '@/lib/apiValidation';
import { captureException } from '@/lib/monitoring/sentry-server';

const VALID_PROVIDERS = ['anthropic', 'meshy', 'hyper3d', 'elevenlabs', 'suno'] as const;

/** PUT /api/keys/:provider — store/update a BYOK key */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // Rate limit: 10 key management requests per minute per user
  const rl = await rateLimit(`keys:${authResult.ctx.user.id}`, 10, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const tierCheck = assertTier(authResult.ctx.user, ['hobbyist', 'creator', 'pro']);
  if (tierCheck) return tierCheck;

  const { provider } = await params;
  const providerResult = requireOneOf(provider, 'Provider', VALID_PROVIDERS);
  if (!providerResult.ok) return providerResult.response;

  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;

  const keyResult = requireString(parsed.body.key, 'API key', { minLength: 8, maxLength: 500 });
  if (!keyResult.ok) return keyResult.response;

  try {
    await storeProviderKey(authResult.ctx.user.id, providerResult.value as Provider, keyResult.value);
    return NextResponse.json({ success: true, provider: providerResult.value, configured: true });
  } catch (err) {
    captureException(err, { route: '/api/keys/[provider]', method: 'PUT' });
    return NextResponse.json({ error: 'Failed to store provider key' }, { status: 500 });
  }
}

/** DELETE /api/keys/:provider — remove a BYOK key */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // Rate limit: 10 key management requests per minute per user
  const rl = await rateLimit(`keys:${authResult.ctx.user.id}`, 10, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const { provider } = await params;
  const providerResult = requireOneOf(provider, 'Provider', VALID_PROVIDERS);
  if (!providerResult.ok) return providerResult.response;

  try {
    await deleteProviderKey(authResult.ctx.user.id, providerResult.value as Provider);
    return NextResponse.json({ success: true, provider: providerResult.value, configured: false });
  } catch (err) {
    captureException(err, { route: '/api/keys/[provider]', method: 'DELETE' });
    return NextResponse.json({ error: 'Failed to delete provider key' }, { status: 500 });
  }
}
