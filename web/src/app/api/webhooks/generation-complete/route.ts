/**
 * POST /api/webhooks/generation-complete — durable, server-side generation
 * callback (PF-906, #8816).
 *
 * Delivered by Upstash QStash (NOT a provider — no provider offers a native
 * completion webhook). The generate route publishes a delayed message here
 * after submitting an async job; this handler polls the provider and either
 * finalizes the `generation_jobs` row (+ refunds on failure) or re-publishes
 * itself with a delay until the job reaches a terminal state. This makes the
 * refund-on-failure durable even when the user has closed the tab.
 *
 * DORMANT BY DEFAULT: unauthenticated like the Stripe webhook, but every
 * request is verified against the QStash signing keys. When QStash is unset the
 * endpoint 401s and nothing publishes here, so it is inert.
 *
 * Idempotency / safety:
 * - The row update is guarded on a non-terminal status, so it never clobbers a
 *   result a live client already imported.
 * - `refundTokens` is idempotent (unique partial index on the usage id), so the
 *   durable refund and the client refund credit the user at most once.
 * - A missing row (tab closed before the client POSTed `/api/jobs`) is not an
 *   error — the refund is keyed on the token usage id, not the row.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  isQstashConfigured,
  verifyQstashSignature,
  publishGenerationCallback,
  type GenerationCallbackPayload,
} from '@/lib/qstash/client';
import {
  pollProviderStatus,
  ASYNC_TYPE_TO_DB_CAPABILITY,
  type AsyncGenerationType,
} from '@/lib/generate/pollProviderStatus';
import { updateJobStatusByProviderJob } from '@/lib/generate/jobRecord';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { DB_PROVIDER } from '@/lib/config/providers';
import { refundTokens } from '@/lib/tokens/service';
import { captureException } from '@/lib/monitoring/sentry-server';

const ROUTE = '/api/webhooks/generation-complete';
/** Max times the callback re-arms itself before giving up and refunding. */
const MAX_ATTEMPTS = 60;
/** Delay before each re-poll while the provider job is still in flight (s). */
const REPUBLISH_DELAY_SECONDS = 15;

// Own keys only — `value in obj` would also accept inherited Object.prototype
// keys ('constructor', 'toString', …), which then index to `undefined` and
// poison the key-resolution path (a forged 'constructor' type would mark a real
// in-flight job failed). A Set of own keys narrows to exactly the real types.
const VALID_ASYNC_TYPES = new Set<string>(Object.keys(ASYNC_TYPE_TO_DB_CAPABILITY));

function isAsyncType(value: unknown): value is AsyncGenerationType {
  return typeof value === 'string' && VALID_ASYNC_TYPES.has(value);
}

/**
 * Best-effort row update. Never throws: a missing row or a transient DB error
 * must not block the refund (the critical action) or wedge the QStash retry.
 */
async function safeUpdateJob(
  providerJobId: string,
  userId: string,
  updates: Parameters<typeof updateJobStatusByProviderJob>[2],
): Promise<void> {
  try {
    await updateJobStatusByProviderJob(providerJobId, userId, updates);
  } catch (err) {
    captureException(err, { route: ROUTE, action: 'update_job', providerJobId });
  }
}

/** Finalize the row as failed and issue the (idempotent) refund. */
async function finalizeFailedAndRefund(
  userId: string,
  providerJobId: string,
  tokenUsageId: string | null,
  errorMessage: string,
): Promise<void> {
  await safeUpdateJob(providerJobId, userId, { status: 'failed', errorMessage });
  if (tokenUsageId) {
    try {
      await refundTokens(userId, tokenUsageId);
    } catch (err) {
      captureException(err, { route: ROUTE, action: 'refund', providerJobId });
    }
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isQstashConfigured()) {
    return NextResponse.json({ error: 'QStash not configured' }, { status: 401 });
  }

  // Signature is computed over the raw body bytes — read text(), not json().
  const body = await request.text();
  const verified = await verifyQstashSignature(body, request.headers.get('upstash-signature'));
  if (!verified) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: GenerationCallbackPayload;
  try {
    payload = JSON.parse(body) as GenerationCallbackPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { userId, providerJobId, type, tokenUsageId } = payload;
  const attempt = typeof payload.attempt === 'number' ? payload.attempt : 0;
  if (!userId || !providerJobId || !isAsyncType(type)) {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 });
  }

  // Resolve the same provider key the user's own status route would use.
  let apiKey: string;
  try {
    const resolved = await resolveApiKey(userId, DB_PROVIDER[ASYNC_TYPE_TO_DB_CAPABILITY[type]], 0, 'status_check');
    apiKey = resolved.key;
  } catch (err) {
    // Key gone (downgrade / removed BYOK) → we can never poll. Finalize +
    // refund so the user isn't stuck, and stop retrying (200, not 500).
    if (!(err instanceof ApiKeyError)) {
      captureException(err, { route: ROUTE, action: 'resolve_key', providerJobId });
    }
    await finalizeFailedAndRefund(userId, providerJobId, tokenUsageId, 'Provider key unavailable for status check');
    return NextResponse.json({ ok: true, finalized: 'failed', reason: 'key_unavailable' });
  }

  try {
    const result = await pollProviderStatus(type, providerJobId, apiKey);

    if (result.status === 'completed') {
      await safeUpdateJob(providerJobId, userId, {
        status: 'completed',
        progress: 100,
        resultUrl: result.resultUrl,
        resultMeta: result.resultMeta,
      });
      return NextResponse.json({ ok: true, finalized: 'completed' });
    }

    if (result.status === 'failed') {
      // Covers both provider-failure and succeededButEmpty (#8757).
      await finalizeFailedAndRefund(userId, providerJobId, tokenUsageId, result.errorMessage ?? `${type} generation failed`);
      return NextResponse.json({ ok: true, finalized: 'failed' });
    }

    // Still pending / processing — re-arm, or time out after MAX_ATTEMPTS.
    if (attempt + 1 >= MAX_ATTEMPTS) {
      await finalizeFailedAndRefund(userId, providerJobId, tokenUsageId, `${type} generation timed out`);
      return NextResponse.json({ ok: true, finalized: 'timeout' });
    }

    await safeUpdateJob(providerJobId, userId, { status: 'processing', progress: result.progress });
    await publishGenerationCallback({ ...payload, attempt: attempt + 1 }, { delaySeconds: REPUBLISH_DELAY_SECONDS });
    return NextResponse.json({ ok: true, rearmed: true, attempt: attempt + 1 });
  } catch (err) {
    // Transport / provider error → 500 so QStash retries with its own backoff.
    captureException(err, { route: ROUTE, action: 'poll', providerJobId, type });
    return NextResponse.json({ error: 'Poll failed' }, { status: 500 });
  }
}
