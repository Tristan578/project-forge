export const maxDuration = 60; // API_MAX_DURATION_STANDARD_GEN_S

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { SpriteClient } from '@/lib/generate/spriteClient';
import { captureException } from '@/lib/monitoring/sentry-server';
import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit, aggregateGenerationRateLimit } from '@/lib/rateLimit/distributed';
import { sanitizePrompt } from '@/lib/ai/contentSafety';
import { refundTokens } from '@/lib/tokens/service';
import { TOKEN_COSTS } from '@/lib/tokens/pricing';
import { DB_PROVIDER } from '@/lib/config/providers';


export async function POST(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // Aggregate rate limit across ALL generation routes (30 req / 15 min per user)
  const aggRl = await aggregateGenerationRateLimit(authResult.ctx.user.id);
  if (!aggRl.allowed) return rateLimitResponse(aggRl.remaining, aggRl.resetAt);

  // 1b. Rate limit: 10 generation requests per 5 minutes per user
  const rl = await distributedRateLimit(`gen-spritesheet:${authResult.ctx.user.id}`, 10, 300);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  // 2. Parse request
  let body: {
    prompt: string;
    frameCount?: number;
    style?: 'pixel-art' | 'hand-drawn' | 'vector' | 'realistic';
    size?: '32x32' | '64x64' | '128x128' | '256x256';
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    prompt,
    frameCount = 4,
    style,
    size = '64x64',
  } = body;

  // Validate
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
    return NextResponse.json(
      { error: 'prompt is required (min 3 characters)' },
      { status: 422 }
    );
  }

  if (frameCount < 2 || frameCount > 8) {
    return NextResponse.json(
      { error: 'frameCount must be between 2 and 8' },
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
  if (!safePrompt || safePrompt.trim().length === 0) {
    return NextResponse.json(
      { error: 'Prompt is empty after sanitization' },
      { status: 422 }
    );
  }

  // 3. Resolve API key (Replicate for ControlNet)
  const tokenCost = frameCount * TOKEN_COSTS.sprite_sheet_cost_per_frame;

  let apiKey: string;
  let usageId: string | undefined;

  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      DB_PROVIDER.sprite,
      tokenCost,
      'sprite_sheet_generation',
      { prompt: safePrompt.trim(), frameCount, style, size }
    );
    apiKey = resolved.key;
    usageId = resolved.usageId;
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
    }
    throw err;
  }

  // 4. Call sprite sheet generation
  const client = new SpriteClient(apiKey, 'sdxl');

  try {
    const result = await client.generateSpriteSheet({
      prompt: safePrompt.trim(),
      frameCount,
      style,
      size,
    });

    return NextResponse.json(
      {
        jobId: result.taskId,
        provider: DB_PROVIDER.sprite,
        status: result.status,
        estimatedSeconds: frameCount * 10,
        usageId,
      },
      { status: 201 }
    );
  } catch (err) {
    // Refund tokens on provider failure
    if (usageId) {
      try {
        await refundTokens(authResult.ctx.user.id, usageId);
      } catch (refundErr) {
        captureException(refundErr, { route: '/api/generate/sprite-sheet', action: 'refund', usageId });
      }
    }
    captureException(err, { route: '/api/generate/sprite-sheet', prompt: safePrompt.trim() });
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
