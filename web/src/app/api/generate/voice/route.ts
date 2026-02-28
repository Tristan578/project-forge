import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { ElevenLabsClient } from '@/lib/generate/elevenlabsClient';
import { captureException } from '@/lib/monitoring/sentry-server';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // 1b. Rate limit: 10 generation requests per 5 minutes per user
  const rl = rateLimit(`gen-voice:${authResult.ctx.user.id}`, 10, 300_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  // 2. Parse request
  let body: {
    text: string;
    voiceId?: string;
    voiceStyle?: string;
    stability?: number;
    similarityBoost?: number;
    style?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { text, voiceId, stability, similarityBoost } = body;

  // Map voice style strings to ElevenLabs numeric style values (0.0–1.0)
  const voiceStyleMap: Record<string, number> = {
    neutral: 0,
    friendly: 0.3,
    calm: 0.2,
    excited: 1.0,
    sinister: 0.7,
  };
  const style = body.voiceStyle ? (voiceStyleMap[body.voiceStyle] ?? 0) : body.style;

  // Validate
  if (!text || text.length < 1 || text.length > 1000) {
    return NextResponse.json(
      { error: 'Text must be between 1 and 1000 characters' },
      { status: 422 }
    );
  }

  // 3. Resolve API key and deduct tokens
  const tokenCost = getTokenCost('voice_generation');

  let apiKey: string;

  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      'elevenlabs',
      tokenCost,
      'voice_generation',
      { text, textLength: text.length }
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
    const result = await client.generateVoice({
      text,
      voiceId,
      stability,
      similarityBoost,
      style,
    });

    return NextResponse.json({
      audioBase64: result.audioBase64,
      durationSeconds: result.durationSeconds,
      provider: 'elevenlabs',
    });
  } catch (err) {
    captureException(err, { route: '/api/generate/voice', text });
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
