import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { SpriteClient } from '@/lib/generate/spriteClient';

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

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

  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      'replicate',
      tokenCost,
      'tileset_generation',
      { prompt, tileSize, gridSize }
    );
    apiKey = resolved.key;
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
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
