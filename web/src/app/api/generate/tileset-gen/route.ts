import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { SpriteClient } from '@/lib/generate/spriteClient';
import { captureException } from '@/lib/monitoring/sentry-server';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { refundTokens } from '@/lib/tokens/service';

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // 1b. Rate limit: 10 generation requests per 5 minutes per user
  const rl = rateLimit(`gen-tileset:${authResult.ctx.user.id}`, 10, 300_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  // 2. Parse request
  let body: {
    prompt: string;
    tileSize?: 16 | 32 | 48 | 64;
    gridSize?: '4x4' | '8x8' | '16x16';
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    prompt,
    tileSize = 32,
    gridSize = '8x8',
  } = body;

  // Validate
  if (!prompt || prompt.length < 3 || prompt.length > 500) {
    return NextResponse.json(
      { error: 'Prompt must be between 3 and 500 characters' },
      { status: 422 }
    );
  }

  // 3. Resolve API key (Replicate for tiling mode)
  const tokenCost = 50;

  let apiKey: string;
  let usageId: string | undefined;

  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      'replicate',
      tokenCost,
      'tileset_generation',
      { prompt, tileSize, gridSize }
    );
    apiKey = resolved.key;
    usageId = resolved.usageId;
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
    }
    throw err;
  }

  // 4. Call tileset generation
  const client = new SpriteClient(apiKey, 'sdxl');

  try {
    const result = await client.generateTileset({
      prompt,
      tileSize,
      gridSize,
    });

    return NextResponse.json(
      {
        jobId: result.taskId,
        provider: 'replicate',
        status: result.status,
        estimatedSeconds: 60,
      },
      { status: 201 }
    );
  } catch (err) {
    // Refund tokens on provider failure
    if (usageId) {
      try {
        await refundTokens(authResult.ctx.user.id, usageId);
      } catch (refundErr) {
        captureException(refundErr, { route: '/api/generate/tileset-gen', action: 'refund', usageId });
      }
    }
    captureException(err, { route: '/api/generate/tileset-gen', prompt });
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
