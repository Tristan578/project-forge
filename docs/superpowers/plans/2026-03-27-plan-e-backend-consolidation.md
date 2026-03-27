# Plan E: Backend Consolidation (Phase 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Standardize all API routes with `ApiErrorResponse` type, `apiError()` helper, `withApiMiddleware` wrapper, and Zod validation. 100% consistency — no route left behind.

**Depends on:** Plan A only (independent of B/C/D).

**Architecture:** Co-located Zod schemas with each route (`route.schema.ts` adjacent to `route.ts`). `withApiMiddleware` handles auth, rate limiting, validation, and error formatting. `apiError()` helper for consistent error responses.

---

## Task E1: ApiErrorResponse type + apiError() helper

**Files:**
- Create: `web/src/lib/api/errors.ts`
- Test: `web/src/lib/api/__tests__/errors.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// web/src/lib/api/__tests__/errors.test.ts
import { describe, it, expect } from 'vitest';
import { apiError, type ApiErrorResponse } from '../errors';

describe('apiError', () => {
  it('returns NextResponse with error message', async () => {
    const res = apiError(400, 'Invalid input');
    expect(res.status).toBe(400);
    const body: ApiErrorResponse = await res.json();
    expect(body.error).toBe('Invalid input');
    expect(body.code).toBeUndefined();
  });

  it('includes optional error code', async () => {
    const res = apiError(422, 'Validation failed', 'VALIDATION_ERROR');
    const body: ApiErrorResponse = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('uses correct status codes', () => {
    expect(apiError(401, 'Unauthorized').status).toBe(401);
    expect(apiError(403, 'Forbidden').status).toBe(403);
    expect(apiError(429, 'Rate limited').status).toBe(429);
    expect(apiError(500, 'Internal error').status).toBe(500);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// web/src/lib/api/errors.ts
import { NextResponse } from 'next/server';

export interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}

export function apiError(
  status: number,
  error: string,
  code?: string,
  details?: unknown,
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      error,
      ...(code && { code }),
      ...(details !== undefined && { details }),
    },
    { status },
  );
}
```

- [ ] **Step 3: Run test, verify pass**
- [ ] **Step 4: Commit**

---

## Task E2: Add validate option to withApiMiddleware

**Files:**
- Modify: `web/src/lib/api/middleware.ts`
- Test: `web/src/lib/api/__tests__/middleware.test.ts`

- [ ] **Step 1: Write failing test for validation**

```ts
import { z } from 'zod';

it('validates request body with Zod schema', async () => {
  const handler = withApiMiddleware(
    async (req, { body }) => NextResponse.json({ received: body }),
    {
      requireAuth: false,
      validate: z.object({ name: z.string(), count: z.number() }),
    },
  );

  const req = new NextRequest('http://localhost/api/test', {
    method: 'POST',
    body: JSON.stringify({ name: 'test', count: 5 }),
    headers: { 'Content-Type': 'application/json' },
  });

  const res = await handler(req);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.received).toEqual({ name: 'test', count: 5 });
});

it('returns 422 for invalid body', async () => {
  const handler = withApiMiddleware(
    async () => NextResponse.json({ ok: true }),
    {
      requireAuth: false,
      validate: z.object({ name: z.string() }),
    },
  );

  const req = new NextRequest('http://localhost/api/test', {
    method: 'POST',
    body: JSON.stringify({ name: 123 }), // wrong type
    headers: { 'Content-Type': 'application/json' },
  });

  const res = await handler(req);
  expect(res.status).toBe(422);
});
```

- [ ] **Step 2: Add validate option to middleware**

In `withApiMiddleware`, add `validate?: z.ZodSchema` to the options type. Before calling the handler, parse the request body through the schema. On failure, return `apiError(422, 'Validation failed', 'VALIDATION_ERROR', zodError.format())`.

- [ ] **Step 3: Run tests, verify pass**
- [ ] **Step 4: Commit**

---

## Tasks E3-E7: withApiMiddleware migration (5 batches)

Each batch: migrate routes from raw `authenticateRequest()` to `withApiMiddleware`. Add co-located Zod schema. One PR per batch.

### Task E3: Batch 1 — Billing routes (4 routes)

| Route | Current Auth | Schema |
|-------|-------------|--------|
| `/api/billing/checkout/route.ts` | `authenticateRequest` | `z.object({ tier: z.enum(['spark','blaze','inferno','forge']) })` |
| `/api/billing/portal/route.ts` | `authenticateRequest` | No body (GET) |
| `/api/billing/status/route.ts` | `authenticateRequest` | No body (GET) |
| `/api/billing/usage/route.ts` | `authenticateRequest` | No body (GET) |

For each route:
1. Create `route.schema.ts` with Zod schema (if POST/PUT)
2. Replace `authenticateRequest()` + manual validation with `withApiMiddleware({ requireAuth: true, validate: schema })`
3. Replace manual error responses with `apiError()`
4. Update corresponding test mocks
5. Run targeted test: `npx vitest run src/app/api/billing/`
6. Commit

### Task E4: Batch 2 — Community routes (12 routes)

Games CRUD, comments, likes, flags, tags, featured. Same pattern as E3.

### Task E5: Batch 3 — Generate routes (8 routes)

These already use `createGenerationHandler` — migrate to `withApiMiddleware` for consistency. Keep the generation-specific logic (token deduction, provider resolution) but standardize the auth/validation/error wrapper.

### Task E6: Batch 4 — Admin routes (4 routes)

Economics, featured, circuit-breaker. Higher auth level (admin check).

### Task E7: Batch 5 — Miscellaneous (20 routes)

Feedback, bridges, tokens, jobs, keys, projects, publish, chat, health, status, capabilities, vitals, docs, cron, sentry proxy, and remaining routes.

---

## Task E8: Enforcement lint rule

- [ ] **Step 1: Add ESLint rule or grep check**

Add to `scripts/` or as a CI step:
```bash
# Fail if any route file imports authenticateRequest directly
grep -rn "import.*authenticateRequest" web/src/app/api/ --include="route.ts" | grep -v "__tests__" | grep -v "middleware.ts"
```

If any matches: CI fails with "Route files must use withApiMiddleware, not raw authenticateRequest."

- [ ] **Step 2: Add to quality-gates.yml**
- [ ] **Step 3: Commit**

---

**Plan E complete.** Deliverables: `apiError()` helper, Zod validation in `withApiMiddleware`, all 48 routes migrated, enforcement lint rule.
