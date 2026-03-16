import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { MeshyClient } from '@/lib/generate/meshyClient';
import { captureException } from '@/lib/monitoring/sentry-server';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { apiErrorResponse, ErrorCode } from '@/lib/api/errors';

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // 1b. Rate limit: 10 generation requests per 5 minutes per user
  const rl = rateLimit(`gen-model:${authResult.ctx.user.id}`, 10, 300_000);
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
    return apiErrorResponse(ErrorCode.VALIDATION_ERROR, 'Invalid JSON body', 400);
  }

  const { prompt, mode, quality = 'standard', imageBase64, artStyle, negativePrompt } = body;

  // Validate
  if (!prompt || prompt.length < 3 || prompt.length > 500) {
    return apiErrorResponse(
      ErrorCode.VALIDATION_ERROR,
      'Prompt must be between 3 and 500 characters',
      422,
      { details: { field: 'prompt', minLength: 3, maxLength: 500 } }
    );
  }

  if (mode === 'image-to-3d' && !imageBase64) {
    return apiErrorResponse(
      ErrorCode.VALIDATION_ERROR,
      'imageBase64 required for image-to-3d mode',
      422,
      { details: { field: 'imageBase64', mode } }
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
      return apiErrorResponse(ErrorCode.PAYMENT_REQUIRED, err.message, 402, {
        details: { code: err.code },
      });
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
    return apiErrorResponse(ErrorCode.PROVIDER_ERROR, message, 500, {
      details: { provider: 'meshy' },
    });
  }
}
