import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { SpriteClient } from '@/lib/generate/spriteClient';
import { captureException } from '@/lib/monitoring/sentry-server';
import { DB_PROVIDER } from '@/lib/config/providers';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';
import { withRetryGuidance } from '@/lib/generate/retryGuidance';

async function GET_impl(request: NextRequest) {
  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:generate-sprite-status:${id}`, max: 60, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId parameter' }, { status: 400 });
  }

  // DALL-E 3 jobs use a "dalle3:" prefix to signal synchronous completion.
  // Contract: the /generate/sprite POST route sets jobId = "dalle3:<result-url>"
  // when the provider returns an image URL synchronously (no async polling needed).
  if (jobId.startsWith('dalle3:')) {
    const resultUrl = jobId.slice('dalle3:'.length);
    return NextResponse.json({
      jobId,
      status: 'completed',
      progress: 100,
      resultUrl,
    });
  }

  // Poll Replicate for prediction status
  let apiKey: string;
  try {
    const resolved = await resolveApiKey(
      mid.userId!,
      DB_PROVIDER.sprite,
      0,
      'status_check'
    );
    apiKey = resolved.key;
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return redactedJson({ error: err.message, code: err.code }, { status: 402 });
    }
    throw err;
  }

  try {
    const client = new SpriteClient(apiKey, 'sdxl');
    const result = await client.getReplicateStatus(jobId);

    let mappedStatus: 'pending' | 'processing' | 'completed' | 'failed';
    let succeededButEmpty = false;
    if (result.status === 'succeeded') {
      // Replicate can report `succeeded` with an empty output array. Mapping that
      // to `completed` hands useGenerationPolling a completed job with no
      // resultUrl, which throws an uncaught "No result URL" — the job then sticks
      // in `downloading` for the full 5-minute poll cap before refunding with a
      // generic timeout (#8757). Surface it as `failed` so the poller refunds
      // immediately with a meaningful error. Mirrors the pixel-art status route.
      if (result.output?.length) {
        mappedStatus = 'completed';
      } else {
        mappedStatus = 'failed';
        succeededButEmpty = true;
      }
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
        ? withRetryGuidance(succeededButEmpty ? 'Sprite generation produced no image' : 'Sprite generation failed')
        : undefined,
    });
  } catch (err) {
    captureException(err, { route: '/api/generate/sprite/status', jobId });
    // The provider's own text stays server-side: `lib/generate/*Client.ts`
    // folds the upstream RESPONSE BODY into the thrown error, and on the
    // platform path the credential in play is the platform's (#9736).
    return redactedJson({ error: 'Could not read the Sprite generation status. Please try again.' }, { status: 500 });
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const GET = withEgressGuard(GET_impl);
