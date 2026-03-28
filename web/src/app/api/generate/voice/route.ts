export const maxDuration = 60; // API_MAX_DURATION_STANDARD_GEN_S

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { ElevenLabsClient } from '@/lib/generate/elevenlabsClient';
import { captureException } from '@/lib/monitoring/sentry-server';
import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit, aggregateGenerationRateLimit } from '@/lib/rateLimit/distributed';
import { sanitizePrompt } from '@/lib/ai/contentSafety';
import { refundTokens } from '@/lib/tokens/service';
import { DB_PROVIDER } from '@/lib/config/providers';


export async function POST(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // Aggregate rate limit across ALL generation routes (30 req / 15 min per user)
  const aggRl = await aggregateGenerationRateLimit(authResult.ctx.user.id);
  if (!aggRl.allowed) return rateLimitResponse(aggRl.remaining, aggRl.resetAt);

  // 1b. Rate limit: 10 generation requests per 5 minutes per user (distributed)
  const rl = await distributedRateLimit(`gen-voice:${authResult.ctx.user.id}`, 10, 300);
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
  if (!text || typeof text !== 'string' || text.length < 1 || text.length > 1000) {
    return NextResponse.json(
      { error: 'Text must be between 1 and 1000 characters' },
      { status: 422 }
    );
  }

  // 2b. Content safety filter
  const safety = sanitizePrompt(text);
  if (!safety.safe) {
    return NextResponse.json(
      { error: safety.reason ?? 'Content rejected by safety filter' },
      { status: 422 }
    );
  }
  const safeText = safety.filtered ?? text;

  // 3. Resolve API key and deduct tokens
  const tokenCost = getTokenCost('voice_generation');

  let apiKey: string;
  let usageId: string | undefined;

  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      DB_PROVIDER.voice,
      tokenCost,
      'voice_generation',
      { text: safeText, textLength: safeText.length }
    );
    apiKey = resolved.key;
    usageId = resolved.usageId;
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
      text: safeText,
      voiceId,
      stability,
      similarityBoost,
      style,
    });

    return NextResponse.json({
      audioBase64: result.audioBase64,
      durationSeconds: result.durationSeconds,
      provider: DB_PROVIDER.voice,
    });
  } catch (err) {
    // Refund tokens on provider failure
    if (usageId) {
      try {
        await refundTokens(authResult.ctx.user.id, usageId);
      } catch (refundErr) {
        captureException(refundErr, { route: '/api/generate/voice', action: 'refund', usageId });
      }
    }
    captureException(err, { route: '/api/generate/voice', text: safeText });
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
