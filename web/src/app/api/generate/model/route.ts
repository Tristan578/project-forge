import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { MeshyClient } from '@/lib/generate/meshyClient';

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

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

  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      'meshy',
      tokenCost,
      operation,
      { prompt, mode, quality }
    );
    apiKey = resolved.key;
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
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
