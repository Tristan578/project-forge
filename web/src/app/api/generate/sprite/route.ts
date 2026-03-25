export const maxDuration = 60; // API_MAX_DURATION_STANDARD_GEN_S

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { SpriteClient } from '@/lib/generate/spriteClient';
import { captureException } from '@/lib/monitoring/sentry-server';
import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';
import { refundTokens } from '@/lib/tokens/service';
import { sanitizePrompt } from '@/lib/ai/contentSafety';
import { TOKEN_COSTS } from '@/lib/tokens/pricing';
import { SPRITE_ESTIMATED_SECONDS } from '@/lib/config/providers';


export async function POST(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // 1b. Rate limit: 10 generation requests per 5 minutes per user (distributed)
  const rl = await distributedRateLimit(`gen-sprite:${authResult.ctx.user.id}`, 10, 300);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

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
  if (!prompt || typeof prompt !== 'string' || prompt.length < 3 || prompt.length > 500) {
    return NextResponse.json(
      { error: 'Prompt must be between 3 and 500 characters' },
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

  // 3. Determine provider and resolve API key
  const actualProvider = provider === 'auto'
    ? (style === 'pixel-art' ? 'sdxl' : 'dalle3')
    : provider;

  const tokenCost = actualProvider === 'dalle3'
    ? TOKEN_COSTS.sprite_generation_dalle3
    : TOKEN_COSTS.sprite_generation_replicate;
  const serviceName = actualProvider === 'dalle3' ? 'openai' : 'replicate';

  let apiKey: string;
  let usageId: string | undefined;

  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      serviceName,
      tokenCost,
      'sprite_generation',
      { prompt: safePrompt, style, size }
    );
    apiKey = resolved.key;
    usageId = resolved.usageId;
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
      prompt: safePrompt,
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
        estimatedSeconds: SPRITE_ESTIMATED_SECONDS[actualProvider],
        usageId,
      },
      { status: 201 }
    );
  } catch (err) {
    if (usageId) {
      try {
        await refundTokens(authResult.ctx.user.id, usageId);
      } catch (refundErr) {
        captureException(refundErr, { route: '/api/generate/sprite', action: 'refund', usageId });
      }
    }
    captureException(err, { route: '/api/generate/sprite', prompt: safePrompt });
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
