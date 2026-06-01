/**
 * Throttled Sentry capture for hot fail-open / degrade paths.
 *
 * Some protection layers (the global DB rate limiter, the per-route rate
 * limiter) intentionally fail open or degrade when their backing store
 * (Upstash) is unavailable. Those bypasses MUST be observable — but a hot path
 * can fail thousands of times per minute during a sustained Upstash outage, so
 * an unconditional `captureException` would turn the alert into its own storm.
 *
 * `sampledCaptureException` records at most one event per `action` per
 * `SAMPLE_THROTTLE_MS`, giving on-call a clear signal without the flood
 * (issues #8664, #8666).
 */

import { captureException } from '@/lib/monitoring/sentry-server';

/**
 * Minimum interval between forwarded captures for the same `action`.
 * One alert per minute is enough to detect a sustained outage; everything in
 * between is suppressed to avoid a Sentry storm.
 */
export const SAMPLE_THROTTLE_MS = 60_000;

const lastCapturedAt = new Map<string, number>();

/**
 * Forward an exception to Sentry, throttled per `action`.
 *
 * The first failure for a given `action` is captured immediately; subsequent
 * failures for the same `action` within `SAMPLE_THROTTLE_MS` are suppressed.
 * `action` doubles as the throttle bucket and is attached to the Sentry event
 * as `{ action }` (merged with any `extra` context).
 *
 * @returns `true` when the event was forwarded to Sentry, `false` when it was
 *   suppressed by the throttle. Callers can use this for counters/tests.
 */
export function sampledCaptureException(
  action: string,
  error: unknown,
  extra?: Record<string, unknown>,
): boolean {
  const now = Date.now();
  const last = lastCapturedAt.get(action);
  if (last !== undefined && now - last < SAMPLE_THROTTLE_MS) {
    return false;
  }
  lastCapturedAt.set(action, now);
  captureException(error, { action, ...extra });
  return true;
}

/** Reset throttle state — for testing only. */
export function _resetSampledCapture(): void {
  lastCapturedAt.clear();
}
