import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { SunoClient } from '@/lib/generate/sunoClient';

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // 2. Parse request
  let body: {
    prompt: string;
    durationSeconds?: number;
    instrumental?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { prompt, durationSeconds = 30, instrumental = true } = body;

  // Validate
  if (!prompt || prompt.length < 3 || prompt.length > 500) {
    return NextResponse.json(
      { error: 'Prompt must be between 3 and 500 characters' },
      { status: 422 }
    );
  }

  if (durationSeconds < 15 || durationSeconds > 120) {
    return NextResponse.json(
      { error: 'Duration must be between 15 and 120 seconds' },
      { status: 422 }
    );
  }

  // 3. Resolve API key and deduct tokens
  const tokenCost = getTokenCost('music_generation');

  let apiKey: string;

  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      'suno',
      tokenCost,
      'music_generation',
      { prompt, durationSeconds, instrumental }
    );
    apiKey = resolved.key;
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
    }
    throw err;
  }

  // 4. Call Suno API
  const client = new SunoClient({ apiKey });

  try {
    const result = await client.createMusic({
      prompt,
      durationSeconds,
      instrumental,
    });

    return NextResponse.json(
      {
        jobId: result.taskId,
        provider: 'suno',
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
