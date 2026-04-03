---
name: generate-route
description: "Scaffold a new AI generation route using createGenerationHandler. Creates route file, adds pricing entry, adds integration test. Use when adding a new /api/generate/* endpoint."
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
argument-hint: "<route-name> <provider> <operation>"
---

# Scaffold a New Generation Route

Create a new `/api/generate/<route-name>` endpoint using `createGenerationHandler`.

## Arguments

- `route-name`: Directory name under `web/src/app/api/generate/` (e.g. `ambience`)
- `provider`: Provider from `DB_PROVIDER` (e.g. `sfx`, `voice`, `music`, `model3d`, `texture`, `sprite`, `chat`)
- `operation`: Token operation name for pricing (e.g. `ambience_generation`)

## Files to Create/Modify

| # | File | Action |
|---|------|--------|
| 1 | `web/src/app/api/generate/<name>/route.ts` | Create — route handler |
| 2 | `web/src/lib/tokens/pricing.ts` | Edit — add TOKEN_COSTS entry |
| 3 | `web/src/app/api/generate/__tests__/route-integration.test.ts` | Edit — add integration test |
| 4 | `web/src/app/api/__tests__/sentry-regressions.test.ts` | Edit — add to ASYNC_ROUTES if async |

## Step 1: Create the Route File

```typescript
// web/src/app/api/generate/<name>/route.ts

export const maxDuration = 60; // API_MAX_DURATION_STANDARD_GEN_S (use 180 for heavy jobs)

import { createGenerationHandler } from '@/lib/api/createGenerationHandler';
import { DB_PROVIDER } from '@/lib/config/providers';
// Import the provider client (e.g. ElevenLabsClient, MeshyClient, SunoClient)

export const POST = createGenerationHandler<
  { prompt: string; /* route-specific params */ },
  { /* response shape */ }
>({
  route: '/api/generate/<name>',
  provider: DB_PROVIDER.<provider>,
  operation: '<operation>',
  rateLimitKey: 'gen-<name>',

  // Optional overrides (uncomment as needed):
  // rateLimitMax: 10,              // default 10
  // rateLimitWindowSeconds: 300,   // default 300 (5 min)
  // successStatus: 201,            // for async jobs that return jobId
  // promptField: 'text',           // if content safety field isn't 'prompt'
  // skipContentSafety: true,       // if route handles safety in validate()

  // Dynamic pricing (if cost depends on params):
  // tokenCost: (params) => params.count * TOKEN_COSTS.per_item,

  // Dynamic provider (if provider depends on params):
  // provider: (params) => params.useGpu ? 'replicate' : 'openai',

  // Dynamic operation (if operation depends on params):
  // operation: (params) => params.quality === 'high' ? 'op_high' : 'op_standard',

  // Billing metadata (REQUIRED if params contain large fields like base64, arrays):
  // billingMetadata: (params) => ({ prompt: params.prompt, count: params.items.length }),

  validate: (body) => {
    const { prompt } = body as Record<string, unknown>;

    // Always validate prompt/text with typeof + length bounds
    if (!prompt || typeof prompt !== 'string' || prompt.length < 3 || prompt.length > 500) {
      return { ok: false, error: 'Prompt must be between 3 and 500 characters' };
    }

    // Validate enums against explicit allowlists, NOT truthy checks
    // BAD:  if (style && !VALID.includes(style)) — misses falsy non-strings
    // GOOD: if (style !== undefined && (typeof style !== 'string' || !VALID.includes(style)))

    // Validate numbers with Number.isFinite() and Number.isInteger() where appropriate
    // Validate booleans with typeof === 'boolean'

    return {
      ok: true,
      params: {
        prompt: prompt as string,
        // Cast to narrow union types, NOT bare string/number
      },
    };
  },

  execute: async (params, apiKey, ctx) => {
    // Instantiate provider client with apiKey
    // Call provider
    // Return response payload

    // For async jobs, include usageId for client-side refund:
    // return { jobId, provider: DB_PROVIDER.<x>, status: 'pending', estimatedSeconds: 60, usageId: ctx.usageId };

    // For sync results, do NOT include usageId (prevents double refund):
    // return { audioBase64, durationSeconds, provider: DB_PROVIDER.<x> };
  },
});
```

## Step 2: Add Token Pricing

Edit `web/src/lib/tokens/pricing.ts` — add the operation to `TOKEN_COSTS`:

```typescript
// In TOKEN_COSTS object:
<operation>: <cost>,  // e.g. ambience_generation: 30,
```

If cost is dynamic (per-item, per-frame), add a `_per_item` entry and use `tokenCost` callback in the route.

## Step 3: Add Integration Test

Edit `web/src/app/api/generate/__tests__/route-integration.test.ts`.

Add a mock for the provider client (if not already mocked), then add tests:

```typescript
// Happy path
it('<name>: valid request -> <status> with <key field>', async () => {
  const { POST } = await import('@/app/api/generate/<name>/route');
  const res = await POST(makeRequest('http://test/api/generate/<name>', {
    prompt: 'test input',
    // ... required params
  }));
  expect(res.status).toBe(<200 or 201>);
  const data = await res.json();
  expect(data.<key field>).toBeDefined();
});

// Validation rejection
it('<name>: rejects missing prompt', async () => {
  const { POST } = await import('@/app/api/generate/<name>/route');
  const res = await POST(makeRequest('http://test/api/generate/<name>', {}));
  expect(res.status).toBe(422);
});
```

## Step 4: Update Sentry Regression Test (if async)

If the route returns `usageId` in success responses (async job pattern), add the route name to `ASYNC_ROUTES` in `web/src/app/api/__tests__/sentry-regressions.test.ts`.

## Validation Checklist

After creating the route, verify:

```bash
cd web
npx vitest run src/app/api/generate/<name>/
npx vitest run src/app/api/generate/__tests__/route-integration.test.ts
npx vitest run src/app/api/__tests__/sentry-regressions.test.ts
npx eslint --max-warnings 0 src/app/api/generate/<name>/route.ts
npx tsc --noEmit  # (may need NODE_OPTIONS="--max-old-space-size=4096")
```

## Common Mistakes to Avoid

1. **Raw provider strings** — always use `DB_PROVIDER.<x>` from `@/lib/config/providers`, never `'anthropic'` or `'openai'` literals
2. **Truthy checks for optional enum fields** — `if (style && ...)` misses `0`, `false`. Use `style !== undefined && typeof style !== 'string'`
3. **Missing Number.isInteger() on counts** — `frameCount`, `itemCount` must be integers or billing gets fractional costs
4. **Large params in billing metadata** — if params include base64, arrays, or long text, add `billingMetadata` callback to exclude them
5. **textLength before content safety** — if you need text length for billing, handle content safety in `validate()` with `skipContentSafety: true` and compute length from the sanitized text
6. **Missing usageId in async responses** — async job routes MUST include `usageId: ctx.usageId` for client-side refund via polling
7. **Forgetting to add pricing** — route will crash at runtime if `TOKEN_COSTS` doesn't have the operation
