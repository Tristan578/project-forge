import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { SpriteClient } from '@/lib/generate/spriteClient';

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // 2. Parse request
  let body: {
    prompt: string;
    style?: 'pixel-art' | 'hand-drawn' | 'vector' | 'realistic';
    size?: '32x32' | '64x64' | '128x128' | '256x256' | '512x512' | '1024x1024';
    provider?: 'auto' | 'dalle3' | 'sdxl';
    removeBackground?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    prompt,
    style,
    size = '64x64',
    provider = 'auto',
    removeBackground = true,
  } = body;

  // Validate
  if (!prompt || prompt.length < 3 || prompt.length > 500) {
    return NextResponse.json(
      { error: 'Prompt must be between 3 and 500 characters' },
      { status: 422 }
    );
  }

  // 3. Determine provider and resolve API key
  const actualProvider = provider === 'auto'
    ? (style === 'pixel-art' ? 'sdxl' : 'dalle3')
    : provider;

  const tokenCost = actualProvider === 'dalle3' ? 20 : 10;
  const serviceName = actualProvider === 'dalle3' ? 'openai' : 'replicate';

  let apiKey: string;

  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      serviceName,
      tokenCost,
      'sprite_generation',
      { prompt, style, size }
    );
    apiKey = resolved.key;
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
    }
    throw err;
  }

  // 4. Call sprite generation
  const client = new SpriteClient(apiKey, actualProvider);

  try {
    const result = await client.generateSprite({
      prompt,
      style,
      size,
      provider: actualProvider,
      removeBackground,
    });

    // If background removal requested, queue it
    let finalJobId = result.taskId;
    if (removeBackground && result.status === 'completed') {
      // Background removal will be handled by polling hook
      finalJobId = result.taskId;
    }

    return NextResponse.json(
      {
        jobId: finalJobId,
        provider: actualProvider,
        status: result.status,
        estimatedSeconds: actualProvider === 'dalle3' ? 15 : 30,
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
