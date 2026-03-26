export const maxDuration = 180; // API_MAX_DURATION_HEAVY_GEN_S

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { SunoClient } from '@/lib/generate/sunoClient';
import { captureException } from '@/lib/monitoring/sentry-server';
import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit, aggregateGenerationRateLimit } from '@/lib/rateLimit/distributed';
import { refundTokens } from '@/lib/tokens/service';
import { sanitizePrompt } from '@/lib/ai/contentSafety';

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // Aggregate rate limit across ALL generation routes (30 req / 15 min per user)
  const aggRl = await aggregateGenerationRateLimit(authResult.ctx.user.id);
  if (!aggRl.allowed) return rateLimitResponse(aggRl.remaining, aggRl.resetAt);

  // 1b. Rate limit: 10 generation requests per 5 minutes per user (distributed)
  const rl = await distributedRateLimit(`gen-music:${authResult.ctx.user.id}`, 10, 300);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  // 2. Parse request
  let body: {
    prompt: string;
    durationSeconds?: number;
    instrumental?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { prompt, durationSeconds = 30, instrumental = true } = body;

  // Validate
  if (!prompt || typeof prompt !== 'string' || prompt.length < 3 || prompt.length > 500) {
    return NextResponse.json(
      { error: 'Prompt must be between 3 and 500 characters' },
      { status: 422 }
    );
  }

  if (durationSeconds < 15 || durationSeconds > 120) {
    return NextResponse.json(
      { error: 'Duration must be between 15 and 120 seconds' },
      { status: 422 }
    );
  }

  // 2b. Content safety filter
  const safety = sanitizePrompt(prompt);
  if (!safety.safe) {
    return NextResponse.json(
      { error: safety.reason ?? 'Content rejected by safety filter' },
      { status: 422 }
    );
  }
  const safePrompt = safety.filtered ?? prompt;

  // 3. Resolve API key and deduct tokens
  const tokenCost = getTokenCost('music_generation');

  let apiKey: string;
  let usageId: string | undefined;

  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      'suno',
      tokenCost,
      'music_generation',
      { prompt: safePrompt, durationSeconds, instrumental }
    );
    apiKey = resolved.key;
    usageId = resolved.usageId;
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
    }
    throw err;
  }

  // 4. Call Suno API
  const client = new SunoClient({ apiKey });

  try {
    const result = await client.createMusic({
      prompt: safePrompt,
      durationSeconds,
      instrumental,
    });

    return NextResponse.json(
      {
        jobId: result.taskId,
        provider: 'suno',
        status: 'pending',
        estimatedSeconds: 60,
        // usageId intentionally omitted — server handles refund on failure.
      },
      { status: 201 }
    );
  } catch (err) {
    if (usageId) {
      try { await refundTokens(authResult.ctx.user.id, usageId); }
      catch (refundErr) { captureException(refundErr, { route: '/api/generate/music', action: 'refund', usageId }); }
    }
    captureException(err, { route: '/api/generate/music', prompt: safePrompt });
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
