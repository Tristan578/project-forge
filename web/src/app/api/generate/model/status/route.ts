import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { MeshyClient } from '@/lib/generate/meshyClient';
import { captureException } from '@/lib/monitoring/sentry-server';
import { DB_PROVIDER } from '@/lib/config/providers';

export async function GET(request: NextRequest) {
  // 1. Authenticate + rate limit
  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:generate-model-status:${id}`, max: 60, windowSeconds: 60 },
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
      DB_PROVIDER.model3d,
      0, // No cost for status checks
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
    const status = await client.getTaskStatus(jobId);

    // Map Meshy status to our format
    let mappedStatus: 'pending' | 'processing' | 'completed' | 'failed';
    let succeededButEmpty = false;
    if (status.status === 'SUCCEEDED') {
      // Meshy reported SUCCEEDED — but only treat it as completed if it produced a
      // downloadable GLB. A success with no model file must map to `failed`, not
      // `completed`: useGenerationPolling throws an uncaught "No result URL" on a
      // completed job with no resultUrl, so the job sticks in `downloading` for the
      // full poll cap before a generic timeout refund (#8757). Reporting `failed`
      // here routes through the poller's refund path immediately.
      if (status.modelUrls?.glb) {
        mappedStatus = 'completed';
      } else {
        mappedStatus = 'failed';
        succeededButEmpty = true;
      }
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
      resultUrl: mappedStatus === 'completed' ? status.modelUrls?.glb : undefined,
      thumbnailUrl: status.thumbnailUrl,
      error: mappedStatus === 'failed'
        ? (succeededButEmpty ? 'Model generation produced no file' : 'Generation failed')
        : undefined,
    });
  } catch (err) {
    captureException(err, { route: '/api/generate/model/status', jobId });
    const message = err instanceof Error ? err.message : 'Provider error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
