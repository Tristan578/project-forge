import { randomBytes } from 'node:crypto';
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';

/**
 * Shared probe for `/api/capabilities` (#9725 p7).
 *
 * WHY THIS EXISTS. The route is public-rate-limited per client IP, and
 * `rateLimitPublicRoute` falls back to the literal key `unknown` when no
 * forwarded-for header is present. Under `next start` on localhost nothing
 * sets that header, so every un-isolated probe — from every worker, every
 * shard, and every concurrent CI job sharing the one CI Upstash database —
 * keys the SAME `public:capabilities:unknown` bucket. That is what 429'd the
 * E2E runner; the ceiling had already been raised from 30 to 120 when run
 * 33987394245 failed the same way, so a bigger number was never the fix.
 *
 * Every probe therefore presents its own address from the RFC 3849
 * documentation range (`2001:db8::/32`), which represents its own client and
 * still exercises the real endpoint and the real limiter. Browser page loads
 * are isolated separately, per worker process, in `playwright.ci.config.ts`.
 */
export function isolatedClientHeaders(): Record<string, string> {
  const groups = randomBytes(12).toString('hex').match(/.{4}/g)!;
  return { 'x-forwarded-for': '2001:db8:' + groups.join(':') };
}

/**
 * GET `/api/capabilities` as an isolated client, asserting 200 before the
 * caller parses anything.
 *
 * The status assertion belongs here, not in each test: callers used to go
 * straight to `response.json()` and index `body.capabilities`, so a limiter or
 * 500 regression surfaced as "Cannot read properties of undefined (reading
 * 'filter')" instead of naming itself. The failure message carries the body.
 */
export async function getCapabilities(request: APIRequestContext): Promise<APIResponse> {
  const response = await request.get('/api/capabilities', {
    headers: isolatedClientHeaders(),
  });
  expect(response.status(), await response.text()).toBe(200);
  return response;
}
