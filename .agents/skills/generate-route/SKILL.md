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
| 5 | `web/src/app/api/generate/<name>/status/route.ts` | Create if async — `panelTierGateResponseForPoll`, then the `verifyProviderJobOwner` ownership refusal, both before `resolveApiKey`; the POST route must bind the job id (Step 4) |

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
`withApiMiddleware` authenticates and BEFORE `resolveApiKey`, IN THIS ORDER:
call the POLL variant of the shared gate with the SAME panel id the create route
declares; then refuse a job the caller does not own (#10262); then resolve the
key as a zero-cost `STATUS_CHECK_OPERATION`:

```typescript
import { panelTierGateResponseForPoll } from '@/lib/api/panelTierGate';
import { verifyProviderJobOwner } from '@/lib/generate/jobOwnership';
import { jobOwnershipRefusal } from '@/lib/generate/jobOwnershipResponse';
import { STATUS_CHECK_OPERATION } from '@/lib/keys/statusCheckOperation';
// ...
async function GET_impl(request: NextRequest) {
  const mid = await withApiMiddleware(request, { /* requireAuth, rateLimit */ });
  if (mid.error) return mid.error;
  const tierDenied = panelTierGateResponseForPoll('<panel-id>', mid.authContext!.user);
  if (tierDenied) return tierDenied;

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'Missing jobId parameter' }, { status: 400 });

  // Ownership (#10262): resolveApiKey returns the PLATFORM key, so without
  // this any signed-in caller could poll another user's job and read its result.
  const ownership = await verifyProviderJobOwner(mid.userId!, DB_PROVIDER.<x>, jobId);
  if (ownership !== 'owner') return jobOwnershipRefusal(ownership);

  const resolved = await resolveApiKey(mid.userId!, DB_PROVIDER.<x>, 0, STATUS_CHECK_OPERATION);
  // ... send the provider `jobId` and nothing else the caller chose
}
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
could poll a creator-tier provider with the platform key. The tier gate is
NOT a job-ownership check; the `verifyProviderJobOwner` refusal after it is.

**The ownership check (#10262).** Write it exactly as above, because
`src/app/api/__tests__/jobOwnershipCoverage.test.ts` reads its shape from every
route, at any path, that calls or references a KEY EXPORT of
`@/lib/keys/resolver`: every exported value binding of that module, derived
from its source on each run (`resolveApiKey`, `resolveByokOrPlatformKey`, and
any export added later, whatever its initializer), minus the pinned
`NON_KEY_RESOLVER_EXPORTS` (`ApiKeyError`, `storeProviderKey`,
`deleteProviderKey`, `listConfiguredProviders`):

- both statements are top-level statements of the handler's own body, ahead of
  the statement holding the key call (`resolveApiKey(...)`), and the verdict is a `const`;
- test the HIT, `ownership !== 'owner'`. The verdict has three states, and
  `=== 'not_owner'` lets `'unverifiable'` (a failed lookup) through to the
  platform key. `jobOwnershipRefusal` answers `'not_owner'` with a terminal 404
  (the poller fails the job and refunds) and `'unverifiable'` with a retryable
  503 (the poller keeps polling through a DB blip);
- the user is `mid.userId!` from this body's `withApiMiddleware(...)`, the same
  one passed to the key call; never a query or body value;
- `jobId` is the handler's ONLY request input: one `const { searchParams } =
  new URL(request.url)`, one `const jobId = searchParams.get('jobId')`, and the
  provider is sent that `jobId`. A second `searchParams.get(...)`,
  `request.nextUrl`, `request.json()`, `mid.body`, a route-params argument or
  `arguments` is reported, because the provider could then be sent an id
  the check never ran on;
- a module or a global can read the request with no handler argument, so both
  are WHITELISTED: every runtime import is `next/server` or app source under
  `web/src` (a bare package such as `zod`, `next/headers` in any spelling, and
  any `import()`, `require`, `module.require` or `import x = require(...)` are
  reported — put that code in a helper under `src/lib` and import the helper),
  and the only globals read are those in the test's `ALLOWED_GLOBALS` (`new
  URL(...)`, `Object.keys/values/entries`, `JSON`, `Math`, `Number`, ...;
  never `process` — not even `process.env` — `globalThis`, `global`, `eval`,
  `Function` or `Reflect`). `constructor`, `prototype` and `__proto__` may not
  appear in the file, and an element access takes a literal name (`x[0]`,
  `x['a']`, never `x[k]`), because each is a path to `Function` and so to every
  global;
- import `verifyProviderJobOwner` and `withApiMiddleware` and call them by
  that binding. A local of the same name, in any scope, is rejected.

**The POST route must bind the id it hands out**, or the owner's own polls are
refused. `createGenerationHandler` binds `jobIdForOwnership(result)` to the
caller, awaited before the response; `jobIdForOwnership` defaults to
`asyncJob.providerJobId`, so a route that declares `asyncJob` binds by default.
A route with no `asyncJob` (pixel-art: no `generation_type` member) must set
`jobIdForOwnership: (result) => result.jobId` explicitly. The coverage test
looks for one of the two in the nearest ancestor route that calls
`createGenerationHandler`.

Add route tests: a `'not_owner'` verdict answers 404 with
`JOB_NOT_FOUND_MESSAGE`, and an `'unverifiable'` one 503 with
`JOB_OWNERSHIP_UNAVAILABLE_MESSAGE`, with `resolveApiKey` and the provider
client never called in either; the check runs with the authenticated user id,
`DB_PROVIDER.<x>` and the polled `jobId`, BEFORE `resolveApiKey`; and the
provider client receives exactly the polled `jobId` when decoy ids
(`predictionId`, `taskId`, `id`) sit beside it in the query. A route the gate
should not hold to this shape (a key resolved for a new, token-charged
operation, a bundled secondary key resolved inside the `execute` step of a
charged `createGenerationHandler` generation for its `ctx.userId`, or a signed
server-to-server callback) goes in the test's `KEY_RESOLVING_EXEMPTIONS` with a
reason and one of the kinds `charged-new-operation`,
`bundled-step-of-charged-generation` (today `api/generate/sprite/route.ts`) or
`qstash-signed-callback`, whose property the test re-checks; that is a
security decision for review, not a way to make the test pass.

Add tier-gate route tests too: an account below the
panel's tier (for a creator panel, a starter with or without tokens) gets 403
`TIER_REQUIRED` and `resolveApiKey` is never called; for a hobbyist panel, a
starter with a spent trial balance is admitted and a never-granted starter
(every token column 0) is refused. For a creator panel, where both variants
refuse the same accounts, spy on `@/lib/api/panelTierGate` and assert the
route calls `panelTierGateResponseForPoll` and not `panelTierGateResponse`.

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
# If the route is async: the ONLY gate that detects a status poller without the
# ownership check, or a POST route that binds no job id (#10262). Each half is
# mocked in the other half's tests, so every behavioural suite passes without it.
npx vitest run src/app/api/__tests__/jobOwnershipCoverage.test.ts

npx vitest run src/app/api/generate/<name>/   # includes status/route.test.ts: 404 + 503 ownership cases
npx vitest run src/app/api/generate/__tests__/route-integration.test.ts
npx vitest run src/app/api/__tests__/sentry-regressions.test.ts
npx eslint --max-warnings 0 src/app/api/generate/<name>/route.ts
npx tsc --noEmit  # (may need NODE_OPTIONS="--max-old-space-size=4096")
```

## Common Mistakes to Avoid

0. **Exporting the handler directly** — `export const POST = createGenerationHandler(...)` is the pre-#9736 shape and puts the route OUTSIDE `withEgressGuard`, so its responses are never redacted. Nothing in lint, types or the integration suite notices; only `egressGuardCoverage.test.ts` does. Always `const POST_impl = ...; export const POST = withEgressGuard(POST_impl);`, and import `withEgressGuard` from `@/lib/security/egressGuard` — an alias or a locally-defined function of the same name is rejected by the coverage test on purpose
0a. **Missing or misspelled `panel`** — `canAccessPanel` returns true for a panel id absent from `PANEL_TIER_REQUIREMENTS`, so a typo silently removes the server-side tier gate. Copy the id from the map. The same applies to the `panelTierGateResponseForPoll(...)` call in a status poller
0b. **A status poller without the ownership check, or a POST route that binds nothing** — `resolveApiKey` hands a status poll the PLATFORM key, so a poller that skips `verifyProviderJobOwner` lets any signed-in caller read another user's result, and a POST route with neither `asyncJob` nor `jobIdForOwnership` binds nothing, so the owner's own polls get a terminal 404 and a refund. Only `jobOwnershipCoverage.test.ts` sees either (Step 4)
1. **Raw provider strings** — always use `DB_PROVIDER.<x>` from `@/lib/config/providers`, never `'anthropic'` or `'openai'` literals
2. **Truthy checks for optional enum fields** — `if (style && ...)` misses `0`, `false`. Use `style !== undefined && typeof style !== 'string'`
3. **Missing Number.isInteger() on counts** — `frameCount`, `itemCount` must be integers or billing gets fractional costs
4. **Large params in billing metadata** — if params include base64, arrays, or long text, add `billingMetadata` callback to exclude them
5. **textLength before content safety** — if you need text length for billing, handle content safety in `validate()` with `skipContentSafety: true` and compute length from the sanitized text
6. **Missing usageId in async responses** — async job routes MUST include `usageId: ctx.usageId` for client-side refund via polling
7. **Forgetting to add pricing** — `getTokenCost()` returns 0 for unknown operations, so the route silently executes for free. This is revenue loss, not a crash — harder to detect. Always verify the operation key exists in `TOKEN_COSTS` before deploying
