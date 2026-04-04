import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { SpriteClient } from '@/lib/generate/spriteClient';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';
import { DB_PROVIDER } from '@/lib/config/providers';

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const rl = await rateLimit(`user:generate-spritesheet-status:${authResult.ctx.user.id}`, 60, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId parameter' }, { status: 400 });
  }

  // Placeholder sprite sheets (from stub implementation) complete instantly
  if (jobId.startsWith('spritesheet_')) {
    return NextResponse.json({
      jobId,
      status: 'failed',
      progress: 0,
      error: 'Sprite sheet generation is not yet available with the current provider',
    });
  }

  // Poll Replicate for actual prediction status
  let apiKey: string;
  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      DB_PROVIDER.sprite,
      0,
      'status_check'
    );
    apiKey = resolved.key;
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
    }
    throw err;
  }

  try {
    const client = new SpriteClient(apiKey, 'sdxl');
    const result = await client.getReplicateStatus(jobId);

    let mappedStatus: 'pending' | 'processing' | 'completed' | 'failed';
    if (result.status === 'succeeded') {
      mappedStatus = 'completed';
    } else if (result.status === 'failed' || result.status === 'canceled') {
      mappedStatus = 'failed';
    } else if (result.status === 'processing') {
      mappedStatus = 'processing';
    } else {
      mappedStatus = 'pending';
    }

    const resultUrl = mappedStatus === 'completed' && result.output?.length
      ? result.output[0]
      : undefined;

    return NextResponse.json({
      jobId,
      status: mappedStatus,
      progress: mappedStatus === 'completed' ? 100 : mappedStatus === 'processing' ? 50 : 10,
      resultUrl,
      error: mappedStatus === 'failed' ? 'Sprite sheet generation failed' : undefined,
    });
  } catch (err) {
    captureException(err, { route: '/api/generate/sprite-sheet/status', jobId });
    const message = err instanceof Error ? err.message : 'Status check failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
