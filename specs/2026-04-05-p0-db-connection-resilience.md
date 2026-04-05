# P0: Database Connection Resilience

> Closes #8176 — No database connection pooling — traffic spike causes cascading 503s

## Problem

SpawnForge uses the `@neondatabase/serverless` HTTP driver (`neon()`) which executes each SQL statement as an independent HTTPS request to the Neon serverless proxy. There is no client-side connection pooling. Under traffic spikes:

1. Every concurrent Vercel function instance opens its own HTTPS connections to Neon
2. Neon's proxy has a per-project connection limit (default 100 for Pro plan)
3. When limit is hit, new connections are refused → 503 cascading to all routes

Current mitigations exist but are incomplete:
- **Circuit breaker** (`web/src/lib/db/circuitBreaker.ts`): Opens after 5 consecutive transient failures, 30s cooldown. Prevents cascading but doesn't reduce connection pressure.
- **Retry with backoff** (`web/src/lib/db/withRetry.ts`): Retries transient errors 3x with exponential backoff. Helps intermittent issues but amplifies load during a spike.
- **`queryWithResilience()`** (`web/src/lib/db/client.ts:98`): Wraps both circuit breaker + retry. Used in some routes but not all.

### What's Missing

1. **`queryWithResilience()` adoption is incomplete** — many routes call `getDb()` directly without the circuit breaker/retry wrapper
2. **No connection limiting** — during a spike, 200 concurrent Vercel functions × retry attempts = 600+ simultaneous Neon connections
3. **No graceful degradation** — when circuit opens, every request gets a hard 500 error with no user-facing message
4. **No observability** — circuit state isn't exposed to monitoring; we learn about pool exhaustion from user complaints

## Decision: Stay on neon-http

Per the existing evaluation (`.claude/docs/neon-websocket-evaluation.md`), switching to the WebSocket driver adds cold-start latency, reconnection complexity, and hot-reload issues for minimal gain. The HTTP driver's stateless model is the right fit for Vercel serverless. The fix is better utilization of what we have, not a driver change.

## Implementation Plan

### Phase 1: Universal `queryWithResilience()` adoption

**Goal**: Every DB call goes through the circuit breaker.

1. **Audit all `getDb()` call sites** — grep for `getDb()` and identify which ones bypass `queryWithResilience()`
2. **Wrap remaining direct calls** — especially money paths (billing, token deduction, subscription webhooks)
3. **Add ESLint rule** — custom rule or `no-restricted-syntax` config to flag raw `getDb()` usage outside `client.ts`

**Files to modify**:
- All API routes under `web/src/app/api/` that call `getDb()` directly
- `web/src/lib/billing/subscription-lifecycle.ts` — uses `getNeonSql()` directly (CTE paths)
- `web/src/lib/tokens/` — token deduction paths

### Phase 2: External rate limiting via Upstash

**Goal**: Prevent stampedes from overwhelming Neon's per-project connection limit.

A module-level semaphore is **useless on Vercel serverless** — each request runs in an isolated function instance with its own process, so the semaphore never sees more than 1 concurrent operation. The bottleneck is cross-instance, not intra-instance.

Instead, use Upstash Redis (already in the stack for rate limiting) to enforce a sliding-window cap on DB operations across all function instances:

1. **Add a global DB rate limiter** using `@upstash/ratelimit` (already a dependency):

```typescript
// web/src/lib/db/dbRateLimit.ts
import { Ratelimit } from '@upstash/ratelimit';
import { redis } from '@/lib/redis';

// Allow 80 DB operations per second across all Vercel instances.
// Neon Pro plan allows ~100 connections; leave 20 for headroom.
export const dbRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(80, '1 s'),
  prefix: 'db-rate',
});
```

2. **Integrate into `queryWithResilience()`** — check rate limit before executing. If limited, wait briefly (100ms) and retry once, then throw `ServiceUnavailableError`.

3. **Tuning**: The 80/s limit should be configurable via env var `DB_RATE_LIMIT_PER_SECOND` for easy adjustment without redeploy.

**Risk**: Adds ~1ms latency per DB operation for the Redis round-trip. Acceptable given the alternative is cascading 503s.

### Phase 3: Graceful degradation UI

**Goal**: When the circuit is open, show users a meaningful message instead of a raw 500.

1. **Health endpoint** — `GET /api/health` already exists (`web/src/lib/monitoring/healthChecks.ts`) with `checkDatabase()` and `runAllHealthChecks()`. Extend `checkDatabase()` to include `dbCircuitBreaker.getStats()` in its `details` field.
2. **API error standardization** — when `CircuitBreakerOpenError` is caught, return `{ error: 'Service temporarily unavailable', code: 'DB_CIRCUIT_OPEN', retryAfter: 30 }` with HTTP 503
3. **Client-side handler** — detect 503 + `DB_CIRCUIT_OPEN` code, show a toast: "Database temporarily unavailable. Retrying..." with automatic retry

### Phase 4: Observability

**Goal**: Know when pool pressure is rising before users notice.

1. **Expose circuit breaker stats** in the health endpoint (state, failure count, last opened timestamp)
2. **PostHog event** on circuit state transitions (closed→open, open→half-open, half-open→closed)
3. **Sentry breadcrumb** on every circuit breaker trip

## Test Plan

- [ ] Unit test: `queryWithResilience` opens circuit after 5 transient failures
- [ ] Unit test: Upstash rate limiter rejects when over 80/s threshold
- [ ] Unit test: `queryWithResilience` retries once after rate limit, then throws
- [ ] Unit test: API routes return 503 with `retryAfter` when circuit is open
- [ ] Integration test: Rapid concurrent requests don't exceed semaphore limit
- [ ] Grep audit: zero direct `getDb()` calls outside `client.ts`

## Estimated Scope

- **Phase 1**: ~15 files touched (audit + wrap), 1 ESLint rule — **2-3 hours**
- **Phase 2**: 2 new files (dbRateLimit.ts, integration into client.ts) — **1 hour**
- **Phase 3**: 3 files (health route, error handler, client toast) — **1-2 hours**
- **Phase 4**: 3 files (health endpoint additions, PostHog event, Sentry breadcrumb) — **1 hour**
