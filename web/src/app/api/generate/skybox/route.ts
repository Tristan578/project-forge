export const maxDuration = 60; // seconds — skybox generation

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { MeshyClient } from '@/lib/generate/meshyClient';
import { captureException } from '@/lib/monitoring/sentry-server';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { refundTokens } from '@/lib/tokens/service';
import { sanitizePrompt } from '@/lib/ai/contentSafety';

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // 1b. Rate limit: 10 generation requests per 5 minutes per user
  const rl = await rateLimit(`gen-skybox:${authResult.ctx.user.id}`, 10, 300_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  // 2. Parse request
  let body: {
    prompt: string;
    style?: 'realistic' | 'fantasy' | 'sci-fi' | 'cartoon';
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { prompt, style = 'realistic' } = body;

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

  // 3. Resolve API key and deduct tokens
  const tokenCost = getTokenCost('skybox_generation');

  let apiKey: string;
  let usageId: string | undefined;

  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      'meshy',
      tokenCost,
      'skybox_generation',
      { prompt: safePrompt, style }
    );
    apiKey = resolved.key;
    usageId = resolved.usageId;
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
    }
    throw err;
  }

  // 4. Call Meshy API (using text-to-texture for equirectangular panorama)
  const client = new MeshyClient({ apiKey });

  try {
    // Use texture generation with skybox-specific prompt augmentation
    const result = await client.createTextToTexture({
      prompt: `Equirectangular panorama skybox: ${safePrompt}`,
      resolution: '2048',
      style,
      tiling: false,
    });

    return NextResponse.json(
      {
        jobId: result.taskId,
        provider: 'meshy',
        status: 'pending',
        estimatedSeconds: 90,
        usageId,
      },
      { status: 201 }
    );
  } catch (err) {
    if (usageId) {
      try { await refundTokens(authResult.ctx.user.id, usageId); }
      catch (refundErr) { captureException(refundErr, { route: '/api/generate/skybox', action: 'refund', usageId }); }
    }
    captureException(err, { route: '/api/generate/skybox', prompt: safePrompt });
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
