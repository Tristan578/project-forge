export const maxDuration = 180; // seconds — 3D model generation (Meshy) is very slow

import { NextRequest, NextResponse } from 'next/server';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { MeshyClient } from '@/lib/generate/meshyClient';
import { captureException } from '@/lib/monitoring/sentry-server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { sanitizePrompt } from '@/lib/ai/contentSafety';

export async function POST(request: NextRequest) {
  // 1. Authenticate + rate-limit (distributed, 10 req / 5 min per user)
  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `gen-model:${id}`, max: 10, windowSeconds: 300 },
  });
  if (mid.error) return mid.error;
  const authResult = { ctx: mid.authContext! };

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
      'meshy',
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
        provider: 'meshy',
        status: 'pending',
        estimatedSeconds: quality === 'high' ? 120 : 60,
        usageId,
      },
      { status: 201 }
    );
  } catch (err) {
    captureException(err, { route: '/api/generate/model', prompt: safePrompt, mode });
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
