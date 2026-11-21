import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { PixelArtClient } from '@/lib/generate/pixelArtClient';
import { captureException } from '@/lib/monitoring/sentry-server';
import { DB_PROVIDER } from '@/lib/config/providers';

// Async status endpoint for pixel-art generation. The POST /generate/pixel-art
// route returns status:'pending' + jobId=predictionId for the DEFAULT Replicate
// (SDXL) provider, and useGenerationPolling polls THIS route every 3s until the
// job completes. Without it every poll 404'd → a guaranteed 5-minute timeout and
// an erroneous refund for the user (#8755). Mirrors the sprite status route.
//
// Note: there is intentionally no synchronous-completion (dalle3-style) prefix
// branch here. The OpenAI pixel-art path returns inline base64 and is marked
// 'completed' by the dialog, so the poll loop (which only polls pending/
// processing jobs) never reaches this route for OpenAI.
export async function GET(request: NextRequest) {
  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:generate-pixel-art-status:${id}`, max: 60, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId parameter' }, { status: 400 });
  }

  // Poll Replicate for prediction status
  let apiKey: string;
  try {
    const resolved = await resolveApiKey(
      mid.userId!,
      DB_PROVIDER.pixel_art,
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
    const client = new PixelArtClient(apiKey, 'replicate');
    const result = await client.getReplicateStatus(jobId);

    let mappedStatus: 'pending' | 'processing' | 'completed' | 'failed';
    if (result.status === 'succeeded') {
      // A "succeeded" prediction with no output URL is an upstream anomaly: the
      // job reports success but produced no image. Surface it as `failed` so the
      // poller refunds the user, rather than `completed` — the completed branch in
      // useGenerationPolling requires a resultUrl and throws an uncaught
      // "No result URL" when it's missing, which would hang the job to the 5-min
      // poll cap (the very failure mode #8755 is about).
      mappedStatus = result.output?.length ? 'completed' : 'failed';
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
      error: mappedStatus === 'failed'
        ? (result.status === 'succeeded'
            ? 'Pixel art generation produced no image'
            : 'Pixel art generation failed')
        : undefined,
    });
  } catch (err) {
    captureException(err, { route: '/api/generate/pixel-art/status', jobId });
    const message = err instanceof Error ? err.message : 'Status check failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
