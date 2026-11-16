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
| 5 | `web/src/app/api/generate/<name>/status/route.ts` | Create if async — `panelTierGateResponseForPoll`, then `verifyProviderJobOwner` (404 `JOB_NOT_FOUND_MESSAGE` / 503 on lookup failure), then `resolveApiKey` (Step 4) |
| 6 | `web/src/app/api/generate/__tests__/statusRouteOwnership.test.ts` | Run — structural pin: fails if the status route resolves a key without the ownership check, or the POST route binds nothing |

## Step 1: Create the Route File

**The exported binding must be a `withEgressGuard(...)` call.** `withEgressGuard`
(`@/lib/security/egressGuard`, #9736) is the runtime chokepoint every API
response leaves through: it redacts the body, every header value, every
`Set-Cookie`, the `Location` and the reason phrase before the response reaches a
client. A route that exports the handler directly is outside that control and
ships unredacted upstream text — the leak the guard exists to stop. Assign the
handler to `POST_impl` (or `GET_impl`, …) and export the wrapped call, exactly as
below; the name must RESOLVE to an import from that module, because
`egressGuardCoverage.test.ts` checks the binding, not the spelling.

```typescript
// web/src/app/api/generate/<name>/route.ts

export const maxDuration = 60; // API_MAX_DURATION_STANDARD_GEN_S (use 180 for heavy jobs)

import { createGenerationHandler } from '@/lib/api/createGenerationHandler';
import { DB_PROVIDER } from '@/lib/config/providers';
import { withEgressGuard } from '@/lib/security/egressGuard';
// Import the provider client (e.g. ElevenLabsClient, MeshyClient)

const POST_impl = createGenerationHandler<
  { prompt: string; /* route-specific params */ },
  { /* response shape */ }
>({
  route: '/api/generate/<name>',
  provider: DB_PROVIDER.<provider>,
  // REQUIRED (#7715): the editor panel that fronts this route. Must be a key of
  // PANEL_TIER_REQUIREMENTS in web/src/lib/ai/tierAccess.ts — an unknown key is
  // default-OPEN, because canAccessPanel returns true for unmapped panels.
  panel: '<panel-id>',
  // The capability this route spends (#9117). ALSO add the route to
  // ROUTE_CAPABILITY in web/src/lib/config/providers.ts — a test walks every
  // generate route and fails on one missing there. When the capability is in
  // UNAVAILABLE_CAPABILITIES the handler refuses 503 before any charge.
  capability: '<capability>',
  operation: '<operation>',
  rateLimitKey: 'gen-<name>',

  // Optional overrides (uncomment as needed):
  // rateLimitMax: 10,              // default 10
  // rateLimitWindowSeconds: 300,   // default 300 (5 min)
  // successStatus: 201,            // for async jobs that return jobId
  // promptField: 'text',           // if content safety field isn't 'prompt'
  // skipContentSafety: true,       // if route handles safety in validate()

  // Dynamic pricing (if cost depends on params):
  // tokenCost: (params) => params.count * TOKEN_COSTS.<operation>_cost_per_item,

  // Dynamic provider (if provider depends on params):
  // provider: (params) => params.useGpu ? DB_PROVIDER.sprite : DB_PROVIDER.image,

  // Dynamic operation (if operation depends on params):
  // operation: (params) => params.quality === 'high' ? 'op_high' : 'op_standard',

  // Billing metadata (REQUIRED if params contain large fields like base64, arrays):
  // billingMetadata: (params) => ({ prompt: params.prompt, count: params.items.length }),

  // Async job (REQUIRED when the route has a status poller that resolves a
  // key, #10262): the extractor's job id is bound to the caller server-side,
  // BEFORE the response leaves, so the status route's `verifyProviderJobOwner`
  // admits the owner and refuses everyone else. `type` must be a
  // `generation_type` enum member listed in ASYNC_TYPE_TO_DB_CAPABILITY.
  // asyncJob: { type: '<type>', providerJobId: (r) => r.jobId, estimatedSeconds: 60 },
  // No enum member for this type (pixel-art)? Bind explicitly instead — with
  // neither field NOTHING is bound and the owner's own poll answers 404:
  // jobIdForOwnership: (r) => r.jobId,

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

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const POST = withEgressGuard(POST_impl);
```

## Step 2: Add Token Pricing

Edit `web/src/lib/tokens/pricing.ts` — add the operation to `TOKEN_COSTS`:

```typescript
// In TOKEN_COSTS object:
<operation>: <cost>,  // e.g. ambience_generation: 30,
```

If cost is dynamic (per-item, per-frame), add a `_cost_per_item` or `_cost_per_frame` entry (matching existing naming: `sprite_sheet_cost_per_frame`) and use `tokenCost` callback in the route.

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

## Step 4: Status Poller (if async)

An async route usually gets a `GET /api/generate/<name>/status` poller. Pollers
call `resolveApiKey()` directly rather than through `createGenerationHandler`,
so the factory's per-panel tier gate does NOT run for them. After
`withApiMiddleware` authenticates and BEFORE `resolveApiKey`, call the POLL
variant of the shared gate with the SAME panel id the create route declares,
and resolve the key as a zero-cost `STATUS_CHECK_OPERATION`:

```typescript
import { panelTierGateResponseForPoll } from '@/lib/api/panelTierGate';
import { STATUS_CHECK_OPERATION } from '@/lib/keys/statusCheckOperation';
import { verifyProviderJobOwner } from '@/lib/generate/jobOwnership';
import { JobOwnershipUnavailableError, JOB_OWNERSHIP_UNAVAILABLE_MESSAGE } from '@/lib/generate/jobOwnershipError';
import { JOB_NOT_FOUND_MESSAGE } from '@/lib/generate/jobNotFound';
import { redactedJson, serviceDegraded } from '@/lib/api/errors';
// ...
if (mid.error) return mid.error;
const tierDenied = panelTierGateResponseForPoll('<panel-id>', mid.authContext!.user);
if (tierDenied) return tierDenied;
// ... parse jobId (400 when missing) ...

// Ownership (#10262) — AFTER the tier gate, BEFORE any key resolves. The
// resolver hands a zero-cost status check the PLATFORM key, so without this
// any signed-in caller could poll someone else's job id.
let isOwner: boolean;
try {
  isOwner = await verifyProviderJobOwner(mid.userId!, DB_PROVIDER.<x>, jobId);
} catch (err) {
  // "Cannot verify" is not "not yours": a lookup failure is the retryable 503
  // SERVICE_DEGRADED the poller keeps polling through, never the 404 below.
  if (err instanceof JobOwnershipUnavailableError) return serviceDegraded(JOB_OWNERSHIP_UNAVAILABLE_MESSAGE);
  throw err;
}
// Not bound to this caller (someone else's, or never bound): the ONE shared
// sentence, because the poller treats this 404 as terminal (refund + stop)
// and shows it to the person verbatim.
if (!isOwner) return NextResponse.json({ error: JOB_NOT_FOUND_MESSAGE }, { status: 404 });

const resolved = await resolveApiKey(mid.userId!, DB_PROVIDER.<x>, 0, STATUS_CHECK_OPERATION);
```

A poll reads a job the caller already paid for, so neither half reads the
live balance. The poll gate judges a `starter` at the trial tier (`hobbyist`)
only when it has HELD tokens (`monthlyTokens > 0 || addonTokens > 0` — a spent
trial still has `monthlyTokens` set), and a never-granted `starter` as plain
`starter`; the resolver skips its tier and balance checks for
exactly that pair (cost 0 AND the constant, never the literal). Do NOT use the
create variant `panelTierGateResponse` here: one generation can spend the whole
trial grant, and the balance-aware rule would then refuse every poll of the job
the user just paid for. Without the gate at all, a caller whose panel is locked
could poll a creator-tier provider with the platform key. The gate is NOT the
job-ownership check — that is `verifyProviderJobOwner` (#10262), which runs
after it and before `resolveApiKey`, and which only admits a job id the POST
route bound to this caller (Step 1's `asyncJob` / `jobIdForOwnership`). Add
route tests: an account below the panel's tier (for a creator panel, a
starter with or without tokens) gets 403 `TIER_REQUIRED` and `resolveApiKey`
is never called; for a hobbyist panel, a starter with a spent trial balance
is admitted and a never-granted starter (every token column 0) is refused.
For a creator panel, where both variants refuse the same accounts, spy on
`@/lib/api/panelTierGate` and assert the route calls
`panelTierGateResponseForPoll` and not `panelTierGateResponse`. For ownership,
mock `@/lib/generate/jobOwnership` (`verifyProviderJobOwner: vi.fn()`) and
assert: `false` → 404 with `JOB_NOT_FOUND_MESSAGE` and no `resolveApiKey`
call; rejects with `JobOwnershipUnavailableError` (import the class from the
un-mocked `@/lib/generate/jobOwnershipError`) → 503 `SERVICE_DEGRADED` and no
`resolveApiKey` call; and the call order `verifyProviderJobOwner` →
`resolveApiKey`. `statusRouteOwnership.test.ts` (file 6) pins the same
ordering structurally across every status route — run it.

## Step 5: Update Sentry Regression Test (if async)

If the route returns `usageId` in success responses (async job pattern), add the route name to `ASYNC_ROUTES` in `web/src/app/api/__tests__/sentry-regressions.test.ts`.

## Validation Checklist

After creating the route, verify:

```bash
cd web
# The ONLY gate that detects an unwrapped route. Run it FIRST — lint, types and
# the integration tests all pass on a route that exports the handler directly,
# so a checklist without this line reports green on a route outside the control.
npx vitest run src/app/api/__tests__/egressGuardCoverage.test.ts
# Async with a status poller: the structural ownership pin (#10262). Fails on a
# status route that resolves a key without verifyProviderJobOwner first, or a
# POST route with neither asyncJob nor jobIdForOwnership.
npx vitest run src/app/api/generate/__tests__/statusRouteOwnership.test.ts

npx vitest run src/app/api/generate/<name>/
npx vitest run src/app/api/generate/__tests__/route-integration.test.ts
npx vitest run src/app/api/__tests__/sentry-regressions.test.ts
npx eslint --max-warnings 0 src/app/api/generate/<name>/route.ts
npx tsc --noEmit  # (may need NODE_OPTIONS="--max-old-space-size=4096")
```

## Common Mistakes to Avoid

0. **Exporting the handler directly** — `export const POST = createGenerationHandler(...)` is the pre-#9736 shape and puts the route OUTSIDE `withEgressGuard`, so its responses are never redacted. Nothing in lint, types or the integration suite notices; only `egressGuardCoverage.test.ts` does. Always `const POST_impl = ...; export const POST = withEgressGuard(POST_impl);`, and import `withEgressGuard` from `@/lib/security/egressGuard` — an alias or a locally-defined function of the same name is rejected by the coverage test on purpose
0a. **Missing or misspelled `panel`** — `canAccessPanel` returns true for a panel id absent from `PANEL_TIER_REQUIREMENTS`, so a typo silently removes the server-side tier gate. Copy the id from the map. The same applies to the `panelTierGateResponseForPoll(...)` call in a status poller
1. **Raw provider strings** — always use `DB_PROVIDER.<x>` from `@/lib/config/providers`, never `'anthropic'` or `'openai'` literals
2. **Truthy checks for optional enum fields** — `if (style && ...)` misses `0`, `false`. Use `style !== undefined && typeof style !== 'string'`
3. **Missing Number.isInteger() on counts** — `frameCount`, `itemCount` must be integers or billing gets fractional costs
4. **Large params in billing metadata** — if params include base64, arrays, or long text, add `billingMetadata` callback to exclude them
5. **textLength before content safety** — if you need text length for billing, handle content safety in `validate()` with `skipContentSafety: true` and compute length from the sanitized text
6. **Missing usageId in async responses** — async job routes MUST include `usageId: ctx.usageId` for client-side refund via polling
7. **Forgetting to add pricing** — `getTokenCost()` returns 0 for unknown operations, so the route silently executes for free. This is revenue loss, not a crash — harder to detect. Always verify the operation key exists in `TOKEN_COSTS` before deploying
8. **Half of the job-ownership binding (#10262)** — a status route that resolves a key without `verifyProviderJobOwner` lets any signed-in caller read another user's result with the platform key; a POST route with neither `asyncJob` nor `jobIdForOwnership` binds nothing, so the OWNER's own poll answers 404 and the poller refunds a job that is still running. Each half is mocked in the other's tests, so only `statusRouteOwnership.test.ts` catches an omission. And never render a lookup FAILURE as that 404 — it is the retryable 503 (`JobOwnershipUnavailableError` → `serviceDegraded`)
