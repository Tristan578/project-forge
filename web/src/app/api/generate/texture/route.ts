import { API_MAX_DURATION_STANDARD_GEN_S } from '@/lib/config/timeouts';
export const maxDuration = API_MAX_DURATION_STANDARD_GEN_S;

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { MeshyClient } from '@/lib/generate/meshyClient';
import { captureException } from '@/lib/monitoring/sentry-server';
import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';
import { refundTokens } from '@/lib/tokens/service';
import { sanitizePrompt } from '@/lib/ai/contentSafety';

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // 1b. Rate limit: 10 generation requests per 5 minutes per user (distributed)
  const rl = await distributedRateLimit(`gen-texture:${authResult.ctx.user.id}`, 10, 300);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  // 2. Parse request
  let body: {
    prompt: string;
    resolution?: '1024' | '2048';
    style?: 'realistic' | 'stylized' | 'cartoon';
    tiling?: boolean;
    entityId?: string;
    generateMaps?: Record<string, boolean>;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { prompt, resolution = '1024', style = 'realistic', tiling = true, entityId, generateMaps } = body;

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
  const tokenCost = getTokenCost('texture_generation');

  let apiKey: string;
  let usageId: string | undefined;

  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      'meshy',
      tokenCost,
      'texture_generation',
      { prompt: safePrompt, resolution, style, entityId }
    );
    apiKey = resolved.key;
    usageId = resolved.usageId;
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
    }
    throw err;
  }

  // 4. Call Meshy API
  const client = new MeshyClient({ apiKey });

  try {
    const result = await client.createTextToTexture({
      prompt: safePrompt,
      resolution,
      style,
      tiling,
      generateMaps,
    });

    return NextResponse.json(
      {
        jobId: result.taskId,
        provider: 'meshy',
        status: 'pending',
        estimatedSeconds: 60,
        usageId,
      },
      { status: 201 }
    );
  } catch (err) {
    if (usageId) {
      try { await refundTokens(authResult.ctx.user.id, usageId); }
      catch (refundErr) { captureException(refundErr, { route: '/api/generate/texture', action: 'refund', usageId }); }
    }
    captureException(err, { route: '/api/generate/texture', prompt: safePrompt });
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
