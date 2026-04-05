import { NextRequest, NextResponse } from 'next/server';
import { assertTier } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { storeProviderKey, deleteProviderKey } from '@/lib/keys/resolver';
import type { Provider } from '@/lib/db/schema';
import { parseJsonBody, requireString, requireOneOf } from '@/lib/apiValidation';
import { captureException } from '@/lib/monitoring/sentry-server';
import { BYOK_PROVIDERS } from '@/lib/config/providers';

/** PUT /api/keys/:provider — store/update a BYOK key */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `keys:${id}`, max: 10, windowSeconds: 60, distributed: false },
  });
  if (mid.error) return mid.error;

  const tierCheck = assertTier(mid.authContext!.user, ['hobbyist', 'creator', 'pro']);
  if (tierCheck) return tierCheck;

  const { provider } = await params;
  const providerResult = requireOneOf(provider, 'Provider', BYOK_PROVIDERS);
  if (!providerResult.ok) return providerResult.response;

  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;

  const keyResult = requireString(parsed.body.key, 'API key', { minLength: 8, maxLength: 500 });
  if (!keyResult.ok) return keyResult.response;

  try {
    await storeProviderKey(mid.userId!, providerResult.value as Provider, keyResult.value);
    return NextResponse.json({ success: true, provider: providerResult.value, configured: true });
  } catch (err) {
    captureException(err, { route: '/api/keys/[provider]', method: 'PUT' });
    return NextResponse.json({ error: 'Failed to store provider key' }, { status: 500 });
  }
}

/** DELETE /api/keys/:provider — remove a BYOK key */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `keys:${id}`, max: 10, windowSeconds: 60, distributed: false },
  });
  if (mid.error) return mid.error;

  const { provider } = await params;
  const providerResult = requireOneOf(provider, 'Provider', BYOK_PROVIDERS);
  if (!providerResult.ok) return providerResult.response;

  try {
    await deleteProviderKey(mid.userId!, providerResult.value as Provider);
    return NextResponse.json({ success: true, provider: providerResult.value, configured: false });
  } catch (err) {
    captureException(err, { route: '/api/keys/[provider]', method: 'DELETE' });
    return NextResponse.json({ error: 'Failed to delete provider key' }, { status: 500 });
  }
}
