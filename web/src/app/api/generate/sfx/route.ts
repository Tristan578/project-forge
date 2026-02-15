import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { ElevenLabsClient } from '@/lib/generate/elevenlabsClient';

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // 2. Parse request
  let body: {
    prompt: string;
    durationSeconds?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { prompt, durationSeconds = 5 } = body;

  // Validate
  if (!prompt || prompt.length < 3 || prompt.length > 500) {
    return NextResponse.json(
      { error: 'Prompt must be between 3 and 500 characters' },
      { status: 422 }
    );
  }

  if (durationSeconds < 0.5 || durationSeconds > 22) {
    return NextResponse.json(
      { error: 'Duration must be between 0.5 and 22 seconds' },
      { status: 422 }
    );
  }

  // 3. Resolve API key and deduct tokens
  const tokenCost = getTokenCost('sfx_generation');

  let apiKey: string;

  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      'elevenlabs',
      tokenCost,
      'sfx_generation',
      { prompt, durationSeconds }
    );
    apiKey = resolved.key;
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
    }
    throw err;
  }

  // 4. Call ElevenLabs API (synchronous)
  const client = new ElevenLabsClient({ apiKey });

  try {
    const result = await client.generateSfx({ prompt, durationSeconds });

    return NextResponse.json({
      audioBase64: result.audioBase64,
      durationSeconds: result.durationSeconds,
      provider: 'elevenlabs',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
