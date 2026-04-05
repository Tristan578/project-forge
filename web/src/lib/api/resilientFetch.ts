/**
 * Client-side fetch wrapper with 503 detection and auto-retry.
 *
 * When a response has status 503 with code DB_CIRCUIT_OPEN or DB_RATE_LIMITED,
 * shows a toast ("Database temporarily unavailable. Retrying...") and retries
 * the request after the Retry-After period. Retries once, then surfaces the
 * error to the caller.
 */

import { toast } from 'sonner';

const DB_ERROR_CODES = new Set(['DB_CIRCUIT_OPEN', 'DB_RATE_LIMITED']);

/**
 * Fetch with automatic 503 retry and user notification.
 *
 * Drop-in replacement for `fetch()` in client components. When the server
 * returns a DB resilience 503, shows a toast and retries once after the
 * Retry-After delay (default 5s). Returns the final response.
 */
export async function resilientFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);

  if (response.status !== 503) return response;

  // Clone before reading body — original response body can only be read once
  const clone = response.clone();
  let code: string | undefined;
  try {
    const body = await clone.json();
    code = body?.code;
  } catch {
    // Non-JSON 503 — not ours, pass through
    return response;
  }

  if (!code || !DB_ERROR_CODES.has(code)) return response;

  // Parse Retry-After header (seconds)
  const retryAfterStr = response.headers.get('Retry-After');
  const retryAfterSec = retryAfterStr ? Math.min(Number(retryAfterStr), 60) : 5;
  const retryAfterMs = (Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec : 5) * 1000;

  toast.info('Database temporarily unavailable. Retrying...', {
    duration: retryAfterMs + 1000,
  });

  await new Promise((r) => setTimeout(r, retryAfterMs));

  // Single retry attempt — re-create request to ensure body is fresh.
  // If input is a Request, clone it; otherwise re-use input+init (string/URL
  // bodies in init are not consumed by fetch).
  if (input instanceof Request) {
    return fetch(input.clone(), init);
  }
  return fetch(input, init);
}
