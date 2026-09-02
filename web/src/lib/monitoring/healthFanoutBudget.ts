import type { RateLimitResult } from '@/lib/rateLimit';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';

/**
 * A single per-IP budget for the *expensive* half of a health check.
 *
 * Rendering a health report costs five outbound network calls — Neon, the
 * engine CDN, Clerk (`HEAD api.clerk.com/v1/jwks`, sending `CLERK_SECRET_KEY`)
 * the chat backend and Upstash (a read-only EVAL, billed per command). Three public
 * surfaces can trigger that fan-out: the `/health`
 * page, `GET /api/health` and `GET /api/status`.
 *
 * Giving each surface its own bucket does not bound the fan-out, it triples it:
 * a caller exhausted on the page simply asks one of the APIs a moment later and
 * gets the probes anyway, so three 30/min buckets are a 90/min fan-out
 * allowance wearing a disguise. All three surfaces therefore share THIS bucket,
 * keyed only on the client IP — not on which surface asked — so the hop between
 * them buys nothing.
 *
 * The budget is consumed by a caller that MISSES the cache. Every surface checks
 * `peekCachedHealthReport()` first; a warm cache is served without touching
 * Upstash at all, because serving a report we already have costs no outbound
 * calls and so needs no fan-out allowance. Raw request volume against the public
 * JSON endpoints is a separate concern, bounded separately by
 * `rateLimitPublicRoute()` in `/api/health` and `/api/status`.
 *
 * A cache miss is not the same as a fan-out. `getCachedHealthReport()`
 * deduplicates concurrent misses onto one in-flight promise, so N simultaneous
 * cold requests from one IP charge N units while only ONE set of probes is
 * actually paid for. That over-charge is deliberate, for two reasons. At check
 * time the outcome is genuinely unknown — whether this caller starts the fan-out
 * or joins one is decided later, inside the cache, and a budget that can only be
 * charged after the fact cannot gate anything. And moving the check inside the
 * cache would leave the `/health` PAGE with no per-IP limiter at all: unlike the
 * two JSON routes it has no `rateLimitPublicRoute()` in front of it, so this
 * budget is the only thing bounding it. Erring strict costs a caller some of a
 * 30/min per-IP allowance in a window no wider than one fan-out; erring loose
 * removes a limiter.
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
