/**
 * POST /api/generate/model — submit a Meshy 3D model generation job.
 * GET  /api/generate/model — poll job status by ?jobId=.
 *
 * Deducts tokens upfront on POST. On failure or client-side cancellation,
 * tokens are refunded via the returned `usageId`. Status is also available
 * via POST /api/generate/model/status.
 */

export const maxDuration = 180; // API_MAX_DURATION_HEAVY_GEN_S

import { NextRequest, NextResponse } from 'next/server';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { refundTokens } from '@/lib/tokens/service';
import { MeshyClient } from '@/lib/generate/meshyClient';
import { captureException } from '@/lib/monitoring/sentry-server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { sanitizePrompt } from '@/lib/ai/contentSafety';
import { aggregateGenerationRateLimit } from '@/lib/rateLimit/distributed';
import { rateLimitResponse } from '@/lib/rateLimit';
import { DB_PROVIDER } from '@/lib/config/providers';


export async function POST(request: NextRequest) {
  // 1. Authenticate + rate-limit (distributed, 10 req / 5 min per user)
  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `gen-model:${id}`, max: 10, windowSeconds: 300 },
  });
  if (mid.error) return mid.error;
  const authResult = { ctx: mid.authContext! };

  // 1b. Aggregate rate limit across ALL generation routes (30 req / 15 min per user)
  const aggRl = await aggregateGenerationRateLimit(authResult.ctx.user.id);
  if (!aggRl.allowed) return rateLimitResponse(aggRl.remaining, aggRl.resetAt);

  // 2. Parse request
  let body: {
    prompt: string;
    mode: 'text-to-3d' | 'image-to-3d';
    quality?: 'standard' | 'high';
    imageBase64?: string;
    artStyle?: string;
    negativePrompt?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { prompt, mode, quality = 'standard', imageBase64, artStyle, negativePrompt } = body;

  // Validate
  if (!prompt || typeof prompt !== 'string' || prompt.length < 3 || prompt.length > 500) {
    return NextResponse.json(
      { error: 'Prompt must be between 3 and 500 characters' },
      { status: 422 }
    );
  }

  if (mode === 'image-to-3d' && !imageBase64) {
    return NextResponse.json(
      { error: 'imageBase64 required for image-to-3d mode' },
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
  const operation = mode === 'image-to-3d' ? 'image_to_3d' : (quality === 'high' ? '3d_generation_high' : '3d_generation_standard');
  const tokenCost = getTokenCost(operation);

  let apiKey: string;
  let usageId: string | undefined;

  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      DB_PROVIDER.model3d,
      tokenCost,
      operation,
      { prompt: safePrompt, mode, quality }
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
    let result: { taskId: string };

    if (mode === 'image-to-3d') {
      result = await client.createImageTo3D({
        imageBase64: imageBase64!,
        prompt: safePrompt,
      });
    } else {
      result = await client.createTextTo3D({
        prompt: safePrompt,
        artStyle,
        negativePrompt,
        quality,
      });
    }

    return NextResponse.json(
      {
        jobId: result.taskId,
        provider: DB_PROVIDER.model3d,
        status: 'pending',
        estimatedSeconds: quality === 'high' ? 120 : 60,
        usageId,
      },
      { status: 201 }
    );
  } catch (err) {
    // Refund tokens on Meshy provider failure (PF-895)
    if (usageId) {
      try {
        await refundTokens(authResult.ctx.user.id, usageId);
      } catch (refundErr) {
        captureException(refundErr, { route: '/api/generate/model', action: 'refund', usageId });
      }
    }
    captureException(err, { route: '/api/generate/model', prompt: safePrompt, mode });
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
