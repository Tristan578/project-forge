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
 * Publish a self-rescheduling generation callback. No-op when QStash is unset
 * so callers never need to guard the call site beyond an `isQstashConfigured()`
 * check. `delaySeconds` is sent to QStash as an integer-second delay.
 */
export async function publishGenerationCallback(
  payload: GenerationCallbackPayload,
  opts: { delaySeconds: number },
): Promise<void> {
  if (!isQstashConfigured()) return;

  const client = new Client({ token: process.env.QSTASH_TOKEN! });
  await client.publishJSON({
    url: getCallbackUrl(),
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
    return await receiver.verify({ body, signature });
  } catch {
    return false;
  }
}
