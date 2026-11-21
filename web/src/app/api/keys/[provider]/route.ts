import { NextRequest, NextResponse } from 'next/server';
import { assertTier } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { requireStepUp } from '@/lib/auth/step-up';
import { STEP_UP_ROUTES } from '@/lib/auth/security-policy';
import { storeProviderKey, deleteProviderKey } from '@/lib/keys/resolver';
import type { Provider } from '@/lib/db/schema';
import { requireOneOf } from '@/lib/apiValidation';
import { captureException } from '@/lib/monitoring/sentry-server';
import { BYOK_PROVIDERS } from '@/lib/config/providers';
import { z } from 'zod';

const keySchema = z.object({
  key: z.string().trim().min(8).max(500),
});

/** PUT /api/keys/:provider — store/update a BYOK key */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `keys:${id}`, max: 10, windowSeconds: 60, distributed: false },
    validate: keySchema,
  });
  if (mid.error) return mid.error;

  // Step-up: storing a BYOK provider key hands the app a long-lived secret.
  // Require a recent 2FA re-verification so a stale session can't plant a key.
  const stepUp = await requireStepUp(STEP_UP_ROUTES['keys-write'].config);
  if (!stepUp.ok) return stepUp.response;

  const tierCheck = assertTier(mid.authContext!.user, ['hobbyist', 'creator', 'pro']);
  if (tierCheck) return tierCheck;

  const { provider } = await params;
  const providerResult = requireOneOf(provider, 'Provider', BYOK_PROVIDERS);
  if (!providerResult.ok) return providerResult.response;

  const { key } = mid.body as z.infer<typeof keySchema>;

  try {
    await storeProviderKey(mid.userId!, providerResult.value as Provider, key);
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

  // Step-up: removing a BYOK key is a security-state change; require a recent
  // 2FA re-verification (matches the write path) so a stale session can't
  // silently strip a user's configured credentials.
  const stepUp = await requireStepUp(STEP_UP_ROUTES['keys-write'].config);
  if (!stepUp.ok) return stepUp.response;

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
