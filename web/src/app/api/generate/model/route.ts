export const maxDuration = 180; // seconds — 3D model generation (Meshy) is very slow

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { MeshyClient } from '@/lib/generate/meshyClient';
import { captureException } from '@/lib/monitoring/sentry-server';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // 1b. Rate limit: 10 generation requests per 5 minutes per user
  const rl = await rateLimit(`gen-model:${authResult.ctx.user.id}`, 10, 300_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

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
  if (!prompt || prompt.length < 3 || prompt.length > 500) {
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
      { prompt, mode, quality }
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
        prompt,
      });
    } else {
      result = await client.createTextTo3D({
        prompt,
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
    captureException(err, { route: '/api/generate/model', prompt, mode });
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
