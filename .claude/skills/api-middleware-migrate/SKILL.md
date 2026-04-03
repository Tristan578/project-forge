---
name: api-middleware-migrate
description: Migrate API routes from raw authenticateRequest to withApiMiddleware pattern. Takes a route file path, reads current auth/billing/validation, generates the middleware wrapper. Use when working on #7431, #7430, #7434.
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
argument-hint: "<route-file-path>"
---

# API Middleware Migration

Migrate a single API route from raw `authenticateRequest()` + manual validation to
the standardized `withApiMiddleware()` pattern.

## Current Pattern (before)

```typescript
export async function POST(req: NextRequest) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const rl = await rateLimit(`user:route:${authResult.ctx.user.id}`, 30, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const body = await req.json();
  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 });
  }

  // ... business logic ...
}
```

## Target Pattern (after)

```typescript
import { withApiMiddleware } from '@/lib/middleware/withApiMiddleware';
import { z } from 'zod';

const bodySchema = z.object({
  name: z.string().min(1),
});

export const POST = withApiMiddleware({
  auth: true,
  rateLimit: { key: 'route', limit: 30, windowMs: 60_000 },
  body: bodySchema,
}, async (req, { user, body }) => {
  // ... business logic using validated body ...
});
```

## Process

### Step 1: Read the route file

```
Read $ARGUMENTS
```

### Step 2: Identify current patterns

Look for:
- `authenticateRequest()` / `safeAuth()` — auth pattern
- `rateLimit()` / `rateLimitPublicRoute()` — rate limiting
- `req.json()` + manual typeof checks — validation
- `deductTokens()` / `creditAddonTokens()` — billing
- `captureException()` — error handling

### Step 3: Generate the Zod schema

Convert manual typeof/regex checks to a Zod schema:
- `typeof x === 'string'` → `z.string()`
- `typeof x === 'number'` → `z.number()`
- `Array.isArray(x)` → `z.array(z.string())`
- `regex.test(x)` → `z.string().regex(pattern)`

### Step 4: Rewrite the route

1. Remove `authenticateRequest()` boilerplate
2. Remove `rateLimit()` boilerplate
3. Remove manual validation
4. Wrap handler in `withApiMiddleware()`
5. Use destructured `{ user, body }` from middleware context

### Step 5: Verify

```bash
cd web && npx tsc --noEmit
cd web && npx vitest run <test-file-for-this-route>
```

## Checklist (per route)

- [ ] Auth pattern identified and migrated
- [ ] Rate limit key and params preserved
- [ ] All manual validation converted to Zod schema
- [ ] Error responses match existing HTTP status codes
- [ ] `await` on all async operations preserved (rateLimit gotcha)
- [ ] Test file updated if it mocks `authenticateRequest` directly
- [ ] TypeScript compiles
- [ ] Tests pass

## Related Issues

- #7431 — Migrate ~60 routes to withApiMiddleware
- #7430 — Extract billing into withTokenBilling middleware
- #7434 — Standardize validation with Zod parseArgs

## Notes

- `withApiMiddleware` doesn't exist yet — create it as part of the first migration
- Model it on Next.js middleware patterns, NOT Express middleware
- The middleware should return `NextResponse` for auth/rateLimit failures
- Business logic handler receives a typed context object
