/**
 * Upstash QStash wrapper for durable, server-side generation callbacks
 * (PF-906, #8816).
 *
 * DORMANT BY DEFAULT. Every function no-ops (publish) or fails closed (verify)
 * when the QStash env vars are unset, so importing this module never throws and
 * the existing client-side poller remains the only completion path until an
 * owner sets `QSTASH_TOKEN` + the two signing keys in the environment.
 *
 * The `Client`/`Receiver` are constructed lazily per call (never at module
 * scope) precisely so a missing env var can never throw at import time — the
 * route-integration suite imports the generate routes with QStash unset and
 * must stay green.
 */

import { Client, Receiver } from '@upstash/qstash';
import { getOptionalEnv } from '@/lib/config/validateEnv';
import { captureMessage } from '@/lib/monitoring/sentry-server';
import type { AsyncGenerationType } from '@/lib/generate/pollProviderStatus';

/**
 * Payload re-delivered to `POST /api/webhooks/generation-complete`. Carries
 * everything the callback needs to poll the provider and finalize the job
 * without any client involvement.
 */
export interface GenerationCallbackPayload {
  /** Owner of the job — the callback resolves this user's provider key. */
  userId: string;
  /** Provider task id returned by the generate route's execute(). */
  providerJobId: string;
  /** generation_type enum member, selects the provider poll + capability. */
  type: AsyncGenerationType;
  /** Token usage id to refund on failure; null for BYOK (nothing was charged). */
  tokenUsageId: string | null;
  /** Re-publish counter; the callback stops re-arming at MAX_ATTEMPTS. */
  attempt: number;
}

/** Path of the webhook the callback is delivered to. */
export const GENERATION_CALLBACK_PATH = '/api/webhooks/generation-complete';

/**
 * Whether QStash is configured. When false the durable path is fully dormant:
 * `publishGenerationCallback` no-ops and `verifyQstashSignature` rejects.
 */
export function isQstashConfigured(): boolean {
  return Boolean(process.env.QSTASH_TOKEN);
}

/** Absolute URL the callback is delivered to (from NEXT_PUBLIC_APP_URL). */
function getCallbackUrl(): string {
  const base = getOptionalEnv('NEXT_PUBLIC_APP_URL').replace(/\/+$/, '');
  return `${base}${GENERATION_CALLBACK_PATH}`;
}

/**
 * True when the callback URL cannot be reached by QStash from the public
 * internet: a loopback host (`localhost`/`127.0.0.1`/`::1`/`*.localhost`) or a
 * relative URL (NEXT_PUBLIC_APP_URL unset, so the base is empty and `new URL`
 * throws). QStash delivers from its own infra, so a loopback target is a
 * mis-set environment, not a valid destination.
 */
function isUnreachableCallbackUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost')
  );
}

/**
 * Publish a self-rescheduling generation callback. No-op when QStash is unset
 * so callers never need to guard the call site beyond an `isQstashConfigured()`
 * check. `delaySeconds` is sent to QStash as an integer-second delay.
 */
export async function publishGenerationCallback(
  payload: GenerationCallbackPayload,
  opts: { delaySeconds: number },
): Promise<void> {
  if (!isQstashConfigured()) return;

  const url = getCallbackUrl();
  // QStash must be able to REACH the callback URL. If QStash is configured but
  // the callback resolves to a loopback/relative host (NEXT_PUBLIC_APP_URL
  // unset or mis-set on a deployed env), publishing would silently black-hole
  // every callback to an unreachable host — the job would then only ever refund
  // via the generic client-side timeout. Skip the publish and surface it loudly
  // rather than burning a QStash message on an undeliverable URL.
  if (isUnreachableCallbackUrl(url)) {
    captureMessage(
      `QStash configured but generation-callback URL is unreachable (${url}); skipping durable publish. Set NEXT_PUBLIC_APP_URL to the public production origin.`,
      'warning',
    );
    return;
  }

  // Bound the SDK's publish retries (default 5) so a transient QStash outage
  // can't retry-storm inside the post-response `after()` callback that drives
  // this publish.
  const client = new Client({ token: process.env.QSTASH_TOKEN!, retry: { retries: 2 } });
  await client.publishJSON({
    url,
    body: payload,
    delay: Math.max(0, Math.round(opts.delaySeconds)),
  });
}

/**
 * Verify the `Upstash-Signature` over the raw request body. Fails CLOSED:
 * returns false when the signature is missing, the signing keys are unset, or
 * the signature is invalid (the SDK throws a `SignatureError` on a bad
 * signature — we catch it and reject rather than surfacing a 500).
 */
export async function verifyQstashSignature(
  body: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature) return false;

  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) return false;

  const receiver = new Receiver({ currentSigningKey, nextSigningKey });
  try {
    // Pass `url` so the SDK also verifies the token's `sub` (destination URL)
    // claim against our own callback URL — a signature minted for one endpoint
    // cannot be replayed against a different one. Fails closed if the claim
    // doesn't match (the SDK throws → caught below → false).
    return await receiver.verify({ body, signature, url: getCallbackUrl() });
  } catch {
    return false;
  }
}
