import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { SpriteClient } from '@/lib/generate/spriteClient';

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId parameter' }, { status: 400 });
  }

  // Poll Replicate for prediction status
  let apiKey: string;
  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      'replicate',
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
      error: mappedStatus === 'failed' ? 'Tileset generation failed' : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Status check failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
