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
    resolution?: '1024' | '2048';
    style?: 'realistic' | 'stylized' | 'cartoon';
    tiling?: boolean;
    entityId?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { prompt, resolution = '1024', style = 'realistic', tiling = true, entityId } = body;

  // Validate
  if (!prompt || prompt.length < 3 || prompt.length > 500) {
    return NextResponse.json(
      { error: 'Prompt must be between 3 and 500 characters' },
      { status: 422 }
    );
  }

  // 3. Resolve API key and deduct tokens
  const tokenCost = getTokenCost('texture_generation');

  let apiKey: string;

  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      'meshy',
      tokenCost,
      'texture_generation',
      { prompt, resolution, style, entityId }
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
    const result = await client.createTextToTexture({
      prompt,
      resolution,
      style,
      tiling,
    });

    return NextResponse.json(
      {
        jobId: result.taskId,
        provider: 'meshy',
        status: 'pending',
        estimatedSeconds: 60,
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
