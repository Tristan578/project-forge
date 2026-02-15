import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { MeshyClient } from '@/lib/generate/meshyClient';

export async function GET(request: NextRequest) {
  // 1. Authenticate
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // 2. Parse query params
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'jobId query parameter required' }, { status: 400 });
  }

  // 3. Resolve API key (no token deduction for status checks)
  let apiKey: string;

  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      'meshy',
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

  // 4. Check status
  const client = new MeshyClient({ apiKey });

  try {
    const status = await client.getTextureStatus(jobId);

    // Map Meshy status to our format
    let mappedStatus: 'pending' | 'processing' | 'completed' | 'failed';
    if (status.status === 'SUCCEEDED') {
      mappedStatus = 'completed';
    } else if (status.status === 'FAILED' || status.status === 'EXPIRED') {
      mappedStatus = 'failed';
    } else if (status.status === 'IN_PROGRESS') {
      mappedStatus = 'processing';
    } else {
      mappedStatus = 'pending';
    }

    return NextResponse.json({
      jobId,
      status: mappedStatus,
      progress: status.progress,
      maps: status.maps,
      error: mappedStatus === 'failed' ? 'Generation failed' : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
