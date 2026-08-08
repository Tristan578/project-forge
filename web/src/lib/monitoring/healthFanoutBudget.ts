import type { RateLimitResult } from '@/lib/rateLimit';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';

/**
 * A single per-IP budget for the *expensive* half of a health check.
 *
 * Rendering a health report costs four outbound network calls — Neon, the
 * engine CDN, Clerk (`GET api.clerk.com/v1/jwks`, sending `CLERK_SECRET_KEY`)
 * and Anthropic. Three public surfaces can trigger that fan-out: the `/health`
 * page, `GET /api/health` and `GET /api/status`.
 *
 * Giving each surface its own bucket does not bound the fan-out, it triples it:
 * a caller exhausted on the page simply asks one of the APIs a moment later and
 * gets the probes anyway, so three 30/min buckets are a 90/min fan-out
 * allowance wearing a disguise. All three surfaces therefore share THIS bucket,
 * keyed only on the client IP — not on which surface asked — so the hop between
 * them buys nothing.
 *
 * The budget is consumed only by a caller that would actually pay for the
 * probes. Every surface checks `peekCachedHealthReport()` first; a warm cache is
 * served without touching Upstash at all, because serving a report we already
 * have costs no outbound calls and so needs no fan-out allowance. Raw request
 * volume against the public JSON endpoints is a separate concern, bounded
 * separately by `rateLimitPublicRoute()` in `/api/health` and `/api/status`.
 */
export const HEALTH_FANOUT_LIMIT = 30;
export const HEALTH_FANOUT_WINDOW_SECONDS = 60;

/**
 * @param clientIp Extract with `getClientIp()` / `getClientIpFromHeaders()` —
 *   never a raw `x-forwarded-for`, which is attacker-controlled and would let
 *   one caller occupy unbounded keys in a shared Redis namespace.
 * @returns The full result, so an API caller can build an honest 429 with
 *   `Retry-After`; a page caller only needs `.allowed`.
 */
export function checkHealthFanoutBudget(clientIp: string): Promise<RateLimitResult> {
  return distributedRateLimit(
    `health-fanout:${clientIp}`,
    HEALTH_FANOUT_LIMIT,
    HEALTH_FANOUT_WINDOW_SECONDS,
  );
}
