import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { MeshyClient } from '@/lib/generate/meshyClient';
import { captureException } from '@/lib/monitoring/sentry-server';
import { DB_PROVIDER } from '@/lib/config/providers';

export async function GET(request: NextRequest) {
  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:generate-texture-status:${id}`, max: 60, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

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
      mid.userId!,
      DB_PROVIDER.texture,
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
    captureException(err, { route: '/api/generate/texture/status', jobId });
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
