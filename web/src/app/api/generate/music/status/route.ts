import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { SunoClient } from '@/lib/generate/sunoClient';

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
      'suno',
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
  const client = new SunoClient({ apiKey });

  try {
    const status = await client.getStatus(jobId);

    // Map Suno status to our format
    let mappedStatus: 'pending' | 'processing' | 'completed' | 'failed';
    if (status.status === 'completed' || status.status === 'succeeded') {
      mappedStatus = 'completed';
    } else if (status.status === 'failed' || status.status === 'error') {
      mappedStatus = 'failed';
    } else if (status.status === 'processing' || status.status === 'generating') {
      mappedStatus = 'processing';
    } else {
      mappedStatus = 'pending';
    }

    return NextResponse.json({
      jobId,
      status: mappedStatus,
      progress: status.progress,
      resultUrl: status.audioUrl,
      durationSeconds: status.durationSeconds,
      error: mappedStatus === 'failed' ? 'Generation failed' : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
