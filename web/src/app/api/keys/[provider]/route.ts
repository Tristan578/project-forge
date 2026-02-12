import { NextResponse } from 'next/server';
import { authenticateRequest, assertTier } from '@/lib/auth/api-auth';
import { storeProviderKey, deleteProviderKey } from '@/lib/keys/resolver';
import type { Provider } from '@/lib/db/schema';

const VALID_PROVIDERS: Provider[] = ['anthropic', 'meshy', 'hyper3d', 'elevenlabs', 'suno'];

/** PUT /api/keys/:provider — store/update a BYOK key */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const tierCheck = assertTier(authResult.ctx.user, ['starter', 'creator', 'studio']);
  if (tierCheck) return tierCheck;

  const { provider } = await params;
  if (!VALID_PROVIDERS.includes(provider as Provider)) {
    return NextResponse.json(
      { error: `Invalid provider. Valid: ${VALID_PROVIDERS.join(', ')}` },
      { status: 400 }
    );
  }

  const body = await req.json();
  const key = body.key as string;
  if (!key || typeof key !== 'string' || key.length < 8) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 400 });
  }

  await storeProviderKey(authResult.ctx.user.id, provider as Provider, key);
  return NextResponse.json({ success: true, provider, configured: true });
}

/** DELETE /api/keys/:provider — remove a BYOK key */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const { provider } = await params;
  if (!VALID_PROVIDERS.includes(provider as Provider)) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  }

  await deleteProviderKey(authResult.ctx.user.id, provider as Provider);
  return NextResponse.json({ success: true, provider, configured: false });
}
