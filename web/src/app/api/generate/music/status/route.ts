import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { panelTierGateResponseForPoll } from '@/lib/api/panelTierGate';
import { withEgressGuard } from '@/lib/security/egressGuard';
import { MUSIC_SYNC_TERMINAL_MESSAGE } from '@/lib/generate/pollProviderStatus';

/**
 * Music generation status (PF-1301 / #9522).
 *
 * Music now routes to ElevenLabs `/v1/music`, which returns the audio inline —
 * `POST /api/generate/music` resolves synchronously and hands the caller the
 * `audioBase64` directly, so no music job is ever enqueued for polling. This
 * endpoint is retained for the async client contract; if it is ever hit, it
 * reports a single terminal state (the job cannot be in flight because there is
 * no provider task). The mapping is kept byte-identical to
 * `pollProviderStatus('music')` — the parity suite pins the two together.
 */
async function GET_impl(request: NextRequest) {
  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:generate-music-status:${id}`, max: 60, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  // Per-panel tier gate, POLL variant (#7715): the panel POST /api/generate/music declares
  // ('generate-music'), kept so every status route is gated alike. A poll reads
  // a job already paid for, so a starter is judged at the trial access tier
  // whatever its live balance — see `src/lib/api/panelTierGate.ts`.
  const tierDenied = panelTierGateResponseForPoll('generate-music', mid.authContext!.user);
  if (tierDenied) return tierDenied;

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'jobId query parameter required' }, { status: 400 });
  }

  // Terminal on the first poll: ElevenLabs music has no async task, so a poll
  // here means the inline result was lost — report failed so the client poller
  // refunds rather than stalling on a job that will never complete.
  return NextResponse.json({
    jobId,
    status: 'failed' as const,
    progress: 0,
    resultUrl: undefined,
    error: MUSIC_SYNC_TERMINAL_MESSAGE,
  });
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const GET = withEgressGuard(GET_impl);
