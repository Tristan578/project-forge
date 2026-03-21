# Upstash Redis Patterns

## Configuration
- SDK: REST API calls (not ioredis) -- works in Vercel serverless/edge
- Env: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (server-only)
- Main file: @web/src/lib/rateLimit/distributed.ts
- Fallback: @web/src/lib/rateLimit.ts (in-memory when Upstash not configured)

## Rate Limiting Pattern
```typescript
import { rateLimitPublicRoute } from '@/lib/rateLimit';
// CRITICAL: Always await!
const rateLimitResult = await rateLimitPublicRoute(request);
if (!rateLimitResult.allowed) {
  return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
}
```

## Gotchas
1. **Always `await` rate limiting calls**. Missing await silently skips rate limiting -- this is the #3 most common agent bug (PF-719, PF-725, PF-730).
2. **Graceful fallback**: When `UPSTASH_REDIS_REST_URL` is not set, falls back to in-memory rate limiting. This means dev/test works without Redis.
3. **Sliding window algorithm**: Uses ZADD + ZREMRANGEBYSCORE + ZCARD in a pipeline for atomicity.
4. **ZREM cleanup**: Consider Lua script for atomic cleanup (PF-744).
5. **REST API, not Redis protocol**: Upstash uses HTTP REST, not raw Redis TCP. Don't use ioredis or node-redis.

## Testing
- Mock the distributed rate limiter in tests
- Test files: `web/src/lib/rateLimit/__tests__/distributed.test.ts`
