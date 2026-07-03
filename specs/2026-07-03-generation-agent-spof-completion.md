# PF-916 (#8826) — Retire the createGenerationHandler SPOF: close the remaining legs (abort forwarding, refund-contract gaps, rollout runbook)

**Ticket:** #8826 (taskboard PF-916, `01KVTCY2FQP3SWV0SP4ZBE696Z`)
**Milestone:** S1: Quality & Reliability
**Prior art:** PR #8833 (`d23b4ba2`) shipped the core slice; ADR `docs/decisions/2026-06-23-generation-agent-spof.md` ("Adopted, flag-gated, default off") is the authoritative design record.
**Delivery:** one PR off `main`, `Closes #8826`, built across 6 sequenced builder dispatches (≤7 logical items each; every dispatch is self-contained — it names the Design sections it implements and the exact files it touches; boundaries in the Test plan).

---

## Corrected premise (supersedes the ticket description)

The issue body and the taskboard ticket both describe replacing a "hand-rolled tool loop" with an AI SDK `ToolLoopAgent`. That premise is stale, corrected twice on the issue itself (2026-06-25 spec comment, 2026-06-27 grounding comment) and by what shipped:

1. **The factory is not a tool loop.** `web/src/lib/api/createGenerationHandler.ts` (475 lines) is a fixed billing/auth/safety pipeline — authenticate → aggregate rate limit → per-route rate limit → parse → validate → content safety → pricing → cache → key-before-deduct (#8597) → execute-once → QStash publish (PF-906, dormant by default) → refund-on-throw → opaque 500. Only 2 of its 12 routes (`localize`, `pacing`) make LLM calls; the other 10 are single-shot provider job submissions (Meshy, Suno, ElevenLabs, Replicate/OpenAI via SpriteClient/PixelArtClient).
2. **The core of this ticket already shipped** in PR #8833 (merged 2026-06-23): `web/src/lib/api/generationAgent.ts` is an "honest single-step executor" behind the global flag `USE_GENERATION_AGENT` (exact string `'true'`, server env, default OFF; check at `generationAgent.ts:166`). It enforces a per-route wall-clock deadline via `deriveGenerationStepTimeoutMs` (`web/src/lib/config/timeouts.ts`; 55s base cap under the ~60s `maxDuration`; model/music 180s and localize 120s pass `maxDurationSeconds` explicitly) and throws typed `GenerationTimeoutError` so the factory's existing refund path runs while the function is still alive. Response contract (incl. `usageId`) is proven identical in both flag states by the flag-on describe block in `web/src/app/api/generate/__tests__/route-integration.test.ts` (29 tests, all 12 routes).
3. **This work is NOT blocked on #8883 (AI SDK v6→v7).** The remaining legs touch no AI SDK surface except passing `abortSignal` into two `generateText` calls — an option supported identically in v6 and v7. The only v7-gated option ("DurableAgent"/`WorkflowAgent` on Vercel Workflows) is explicitly rejected below.
4. **What verifiably remains** (each grounded in code inspection on `origin/main`):
   - **(a) Abort forwarding (ADR follow-up #1).** No generate route forwards `ctx.abortSignal` into its provider call — a repo-wide grep of `web/src/app/api/generate/*/route.ts` returns zero hits. The agent path's abort today cancels only the factory's `await`, not the in-flight provider HTTP request. `ctx` gained optional `abortSignal` at `createGenerationHandler.ts:130`; the agent wrap passes `{ ...ctx, abortSignal: signal }` at ~`:278`.
   - **(b) A live refund bug.** `sprite-sheet/route.ts` and `tileset-gen/route.ts` omit `usageId` from their success payloads (their `execute` returns only `{ jobId, provider, status, estimatedSeconds }` — sprite-sheet `:62–77`, tileset-gen `:49–63`). The client poller early-returns without it (`web/src/hooks/useGenerationPolling.ts:460` — `if (!job?.usageId) return;`), so client-triggered refunds silently no-op for those two async types. The regression scan misses them because `ASYNC_ROUTES` at `web/src/app/api/__tests__/sentry-regressions.test.ts:77` lists only `['model', 'music', 'skybox', 'sprite', 'texture', 'pixel-art']`.
   - **(c) 14 untested factory contract behaviors** (inventory in the Test plan) including a relative-path `vi.mock('../responseCache')` landmine that would silently un-mock on any file move.
   - **(d) The rollout itself** (ADR steps 2–3): `USE_GENERATION_AGENT=true` has never been flipped in any environment — owner-only runbook below, not set by this PR.
   - **(e) The re-scoped durable-polling leg** (2026-06-27 grounding comment): replacing `useGenerationPolling` + the 8 `*/status` routes with a durable completion path. Extracted to **#8892 (PF-938)** — see Out of scope.

## Goal

One PR that completes #8826's factory-scoped work: every generate route forwards the agent-path abort into its provider HTTP call (so a timeout cancels the in-flight provider HTTP request/poll loop, not just the factory's `await` — for async job-submission providers the job already accepted server-side may still complete, which is pre-existing and inherent to async generation; tokens are refunded regardless); the two async routes missing `usageId` return it (restoring client-side refunds); every previously-unpinned factory contract behavior gets a test; one Boy-Scout fix for the `voice/batch` provider-error leak (Design §13); and the flag-flip runbook is documented. Flag-off behavior stays byte-for-byte identical.

## Constraints (restated in full so this spec is self-contained — must hold)

1. **`usageId` must never be removed** from generate route responses — the client needs it for async refunds (this spec only ADDS it where missing).
2. **Factory blast radius**: any factory or route change requires `route-integration.test.ts` green in BOTH flag states.
3. **`refundTokens()` idempotency** (CTE `INSERT … ON CONFLICT DO NOTHING` against `uq_token_usage_refund_idempotent`) is untouched.
4. **Rate limits stay `await`ed**; the auth → aggregate → per-route ordering is not reordered.
5. **Content safety**: `.safe` checked before `.filtered` substitution; primary + `secondaryPromptFields` loop unchanged.
6. **QStash (PF-906) dormancy**: with any of `QSTASH_TOKEN`/`QSTASH_CURRENT_SIGNING_KEY`/`QSTASH_NEXT_SIGNING_KEY` unset, behavior is byte-identical; publish only after successful non-cached execute; publish failure is Sentry-logged, never user-visible; no duplicate job rows.
7. **Status surface untouched**: the 8 `*/status/route.ts` files, `pollProviderStatus.ts`, and the `succeededButEmpty` → `failed` mapping are not modified.
8. **#8817 telemetry untouched**: `captureAiGeneration` in `localize`/`pacing` stays as-is; no LLM-observability concern is added to the factory.
9. **Flag semantics**: `USE_GENERATION_AGENT` enables only on the exact string `'true'`; revert = unset env var.
10. **`??` not `||`** for defaults; token/timeout math guarded by `Number.isFinite`.
11. **Route paths frozen**: no route is added, renamed, or deleted, so the `openapi-route-sync` gate passes without allowlist changes; the only OpenAPI edit is one additive optional property on the shared `GenerationJob` response schema (Design §9) — its documentation reach spans the seven routes that `$ref` it, all of which genuinely return the field after this PR.
12. **No new npm dependencies** → no lockfile change; `AbortSignal.any` is a Node ≥20.3 built-in (repo runs Node 24 per `.node-version`, CI + Vercel match).
13. **No new hardcoded constants**: existing per-fetch timeout literals in provider clients are preserved as-is, not re-derived.
14. **Coverage ratchet (70/60/65/72)**: this PR only adds tests; no suite is weakened or deleted.
15. **Test conventions**: `vi.mock` via `@/lib/...` aliases only (never relative); node-env vitest config for factory/route tests, jsdom for the poller hook; targeted vitest during dev, full gate before push.
16. **Process**: Spec-First (this document), Test-First (failing tests before implementation), ≤7 items per builder dispatch, commit after every logical chunk, changeset required, PR carries `Closes #8826` + milestone `S1: Quality & Reliability`.

## Scope enumeration

| Route (POST) | Provider client | Abort forwarding | `usageId` change |
|---|---|---|---|
| `model`, `texture`, `skybox` | `meshyClient.ts` | yes | none (already returns it, e.g. `model/route.ts:124`) |
| `music` | `sunoClient.ts` | yes | none |
| `sfx`, `voice` | `elevenlabsClient.ts` | yes | none (sync routes) |
| `sprite` | `spriteClient.ts` | yes | none |
| **`sprite-sheet`**, **`tileset-gen`** | `spriteClient.ts` | yes | **ADD `usageId: ctx.usageId`** (live bug) |
| `pixel-art` | `pixelArtClient.ts` | yes | none |
| `localize`, `pacing` | `generateText` (AI SDK) | yes (`abortSignal` option) | none (sync routes) |

Excluded routes/files: `voice/batch` factory migration/hardening (hand-rolled, not factory → **#8893** — EXCEPT its provider-error-message leak, fixed here as a Boy-Scout one-liner, Design §13), `refund/route.ts`, all 8 `*/status/route.ts`, `useGenerationPolling.ts` replacement (→ **#8892**), QStash webhook `generation-complete`.

## Design

### 1. `web/src/lib/generate/abortComposition.ts` (new)

```ts
/**
 * Combine an optional external abort (the generation agent's per-route
 * deadline) with a client's own per-fetch timeout. When no external signal
 * is supplied (flag off, or the inline execute path), this returns exactly
 * AbortSignal.timeout(timeoutMs) — byte-identical to today's behavior.
 */
export function composeAbortSignal(
  external: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}
```

Why safe: `AbortSignal.any` fires on the FIRST of its inputs, so per-fetch timeouts still bound each request exactly as today; the external deadline can only make cancellation earlier, never later. No behavior change when `external` is `undefined`.

### 2. `web/src/lib/generate/meshyClient.ts`

Each public method's params object gains optional `signal?: AbortSignal`. Every internal `signal: AbortSignal.timeout(N)` (lines 70, 97, 118, 149, 170) becomes `signal: composeAbortSignal(params.signal, N)`. Retry/backoff, response parsing, and error mapping are NOT modified.

### 3. `web/src/lib/generate/sunoClient.ts`

Same pattern (lines 45, 66).

### 4. `web/src/lib/generate/elevenlabsClient.ts`

Same pattern for `generateSfx` (line 49) and `generateVoice` (line 87).

### 5. `web/src/lib/generate/spriteClient.ts`

Same pattern for `generateSprite` (68, 104), `generateSpriteSheet` (155), `generateTileset` (189), the `removeBackground` remove.bg call (214), and the internal Replicate polling fetch in `getReplicateStatus` (286) — an aborted job stops the in-client Replicate poll loop immediately rather than running to the poll cap, and an in-flight remove.bg request is cancelled like any other single fetch.

### 6. `web/src/lib/generate/pixelArtClient.ts`

Same pattern for the `PixelArtClient` class methods (class at line 43; both the OpenAI and Replicate paths).

### 7. All 12 `web/src/app/api/generate/*/route.ts` — thread the signal

Each `execute` passes the factory context's abort through: `execute: async (params, apiKey, ctx) => client.method({ ...args, signal: ctx.abortSignal })`. Routes whose `execute` currently omits the third param (`sprite-sheet/route.ts:62`, `tileset-gen/route.ts:49`) gain it. `localize/route.ts:138` and `pacing/route.ts:115` add `abortSignal: ctx.abortSignal` to their `generateText` options (supported in AI SDK v6 and v7 — no dependency on #8883). `ctx.abortSignal` is `undefined` on the inline (flag-off) path, so flag-off requests are unchanged end-to-end.

### 8. `sprite-sheet/route.ts` + `tileset-gen/route.ts` — `usageId` fix (live bug)

`TResult` gains `usageId: string | undefined` and the `execute` return gains `usageId: ctx.usageId`, exactly matching the established pattern (`model/route.ts:28,124`, `sprite/route.ts:30,108`). Additive JSON field; the poller reads it optionally (`useGenerationPolling.ts:460`), so no consumer breaks. This restores the client-side refund path for `sprite_sheet` and `tileset` job types (the QStash server-side path from #8867 remains an independent, idempotent second guard).

**Abuse-resistance rationale (why exposing `usageId` to the client is safe):** the refund route scopes its lookup to the authenticated caller — `eq(tokenUsage.userId, userId)` — so a stolen or guessed `usageId` belonging to another user matches no row; `refundTokens` is idempotent via the CTE `INSERT … ON CONFLICT DO NOTHING` against `uq_token_usage_refund_idempotent`, so replaying one's own `usageId` cannot double-credit; and six async routes (`model`, `music`, `skybox`, `sprite`, `texture`, `pixel-art`) already return `usageId` today, so this adds no new exposure class — it brings two routes up to the existing, protected contract.

### 9. `docs/api/openapi.json`

`/api/generate/sprite-sheet` and `/api/generate/tileset-gen` are documented public paths (verified; only their `/status` sub-routes live in `openapi-internal-routes.json`). Their 201 responses — like five other async routes (`model`, `texture`, `music`, `skybox`, `sprite`) — are a `$ref` to the shared `components.schemas.GenerationJob` schema (`{ jobId, provider, status, estimatedSeconds }`, ~line 123), which today documents `usageId` for NO route. The edit: add `usageId: { type: "string" }` as an **optional** property to the shared `GenerationJob` schema (NOT to `required` — BYOK requests legitimately omit it; do NOT inline per-route schemas, which would diverge from the established `$ref` pattern). This is one additive property whose documentation reach is all seven referencing routes — and that reach is *correct*: the five factory routes above already return `usageId` today, and sprite-sheet/tileset-gen start returning it via Design §8, so after this PR every route referencing `GenerationJob` genuinely returns the field. Run `jq empty docs/api/openapi.json` after editing (a malformed spec 500s `/api-docs` in production).

### 10. `web/src/app/api/__tests__/sentry-regressions.test.ts:77`

`ASYNC_ROUTES` gains `'sprite-sheet'` and `'tileset-gen'` (written FIRST — fails until §8 lands; that failing state is the test-first proof of the bug).

### 11. `docs/decisions/2026-06-23-generation-agent-spof.md`

Update the Follow-ups section: abort forwarding delivered by this PR; durable-polling leg tracked as #8892; voice/batch remaining hardening tracked as #8893 (its error-message leak is closed by this PR, Design §13). Also post a clarifying comment on #8893 recording that split (orchestrator action at implementation time).

### 12. Changeset

`.changeset/<name>.md` — patch bump for the web app; user-visible fix line: "sprite-sheet and tileset-gen generation responses now include usageId so failed jobs refund from the client."

### 13. `web/src/app/api/generate/voice/batch/route.ts:108` — provider-error-message hygiene (Boy Scout)

Live leak found in review: the per-item catch does `error: err instanceof Error ? err.message : 'Generation failed'` (line 108), and `elevenlabsClient.generateVoice` throws `` `ElevenLabs TTS API error (${status}): ${body}` `` — so the raw provider response body lands in the user-visible `errors[].error`, violating the generic-error policy the factory enforces everywhere else. The full error is ALREADY captured server-side by the `captureException(err, { route, nodeId })` at line 105, so no detail is lost. Fix: line 108's user-visible string becomes the constant `'Voice generation failed for this item'`. One line; no control flow, billing, or response-shape changes. One existing test pins the old pass-through and must be updated in the same commit — `voice/batch/route.test.ts:222` (see test 20 for the exact substitution). The broader #8597-class hardening of this route stays in #8893.

## Explicitly out of scope (each with an owning ticket)

- **Durable completion path replacing `useGenerationPolling` + the 8 `*/status` routes** → **#8892 (PF-938)**. The 2026-06-27 grounding comment re-scoped the "durable" ambition of this ticket to the client side and directed choosing ONE backend — QStash (provisioned; server callbacks shipped in #8867), not AI SDK v7 `WorkflowAgent`/Vercel Workflows (new paid product, gated on #8883, would duplicate #8867). Building it here would balloon the PR past reviewable size and couple it to a backend decision that deserves its own spec.
- **`voice/batch` #8597-class hardening** → **#8893 (PF-939)**. Not a factory route; folding the full migration in would widen blast radius for no shared code. Carve-out: its provider-error-message leak (`route.ts:108`) IS fixed in this PR (Design §13) per the Boy Scout Rule — a review-found live leak is never deferred; #8893 keeps the rest and gets a clarifying comment.
- **Flipping `USE_GENERATION_AGENT`** — owner-only env action (runbook below), never a code change in this PR.
- **`@ai-sdk/workflow` install** — rejected per above; also NOT part of #8883.
- **Status routes, `pollProviderStatus.ts`, QStash webhook, `refund/route.ts`** — deliberately untouched (Constraints 6–7).

## Test plan (test-first)

Tests written before the implementation they guard; items marked *(regression pin)* pass against current code by design — their job is to lock behavior this PR must not change, not to fail first. Factory/route/client suites run under the node vitest config; the poller hook test under jsdom. All mocks via `@/lib/...` aliases. Local runs: `env -u UPSTASH_REDIS_REST_URL -u UPSTASH_REDIS_REST_TOKEN npx vitest run <file>`.

**Dispatch 1 — factory contract pinning, part 1.**
*Implements:* no Design section — test-only, pins EXISTING factory behavior. *Files touched:* `web/src/lib/api/__tests__/createGenerationHandler.test.ts` only.
0. FIRST COMMIT: convert `vi.mock('../responseCache')` → `vi.mock('@/lib/api/responseCache')` (project mock rule; a relative mock silently un-mocks if the factory ever moves). No assertion changes.
1. Filtered-prompt substitution: when `sanitizePrompt().safe === true` with `filtered !== input`, `execute` AND `billingMetadata` receive the FILTERED text — for the primary field and a `secondaryPromptFields` entry.
2. Pricing guard: `tokenCost` fn returning `NaN` and `-5` → 500 `"Internal pricing error"` + `captureException`; a THROWING `tokenCost`/`provider`/`operation` config fn → 500 via the `resolve_billing_params` branch.
3. Cached-path refund: `cachedGenerate` MISS whose inner `execute` throws → `refundTokens(userId, usageId)` called, 500 body is `GENERIC_500_MESSAGE`.
4. Cache HIT is free: `resolveApiKey`, `deductTokens`, and the QStash publish are all NOT called; `X-Cache: HIT` header present.
5. Refund-failure resilience: `refundTokens` itself throws → response is still the opaque 500 and `captureException` receives the refund-stage context (`usageId` attached).

**Dispatch 2 — factory contract pinning, part 2.**
*Implements:* no Design section — test-only, pins EXISTING factory behavior. *Files touched:* `web/src/lib/api/__tests__/createGenerationHandler.test.ts` only. Any Dispatch 1–2 test that comes up RED against current code is a real bug — fix the code in this PR (Boy Scout Rule), never adjust the test to match broken behavior.
6. Auth-before-rate-limit: a 401 request consumes zero budget on both limiters (neither mock called).
7. Dormant `after()`: for a non-async route and for an async route with QStash env unset, the captured `after` callback list stays empty.
8. `billingMetadata` default: omitted config → metadata recorded equals validated `params`.
9. `validate` returning `{ ok: false, status: 418 }` → response status 418 (pins `status ?? 422`).
10. Non-string prompt-field value (e.g. numeric) → content-safety loop skips it without throwing (pins intended lenient behavior).

**Dispatch 3 — usageId fix + poller refund.**
*Implements:* Design §8 (`sprite-sheet/route.ts`, `tileset-gen/route.ts` — TResult + return gain `usageId`), §9 (`docs/api/openapi.json` — two response schemas), §10 (`sentry-regressions.test.ts` ASYNC_ROUTES). *Files touched:* those 4 + `route-integration.test.ts` + the poller hook test. 3 code items + 3 test items.
11. `sentry-regressions.test.ts`: extend `ASYNC_ROUTES` per Design §10 (fails first).
12. `route-integration.test.ts`: sprite-sheet + tileset-gen success payloads assert `usageId === ctx.usageId` in BOTH flag states (fails first); then Design §8 lands and both go green.
13. `web/src/hooks/__tests__/useGenerationPolling` (jsdom): a job created WITH `usageId` that exhausts `MAX_POLL_COUNT` → the refund fetch fires with `{ usageId }`; a job WITHOUT `usageId` → no refund fetch (pins the `:460` guard both ways).

**Dispatch 4 — abort composition + audio/3D clients.**
*Implements:* Design §1 (`abortComposition.ts` NEW), §2 (`meshyClient.ts`), §3 (`sunoClient.ts`), §4 (`elevenlabsClient.ts`). *Files touched:* those 4 + 2 test files under `web/src/lib/generate/__tests__/`. 4 code items + 2 test items.
14. `abortComposition.test.ts` (new; tests Design §1): undefined external → returned signal is timeout-driven only; pre-aborted external → result already aborted; external aborts before timeout → result aborts with the external reason.
15. `meshyClient`/`sunoClient`/`elevenlabsClient` (tests Design §2–§4): with a params `signal` that aborts mid-flight, the underlying `fetch` receives a signal that aborts (assert via injected fetch mock capturing `init.signal`); without `signal`, captured signal still enforces the historical per-fetch timeout.

**Dispatch 5 — remaining clients.**
*Implements:* Design §5 (`spriteClient.ts`), §6 (`pixelArtClient.ts`) — the same `composeAbortSignal` pattern Dispatch 4 applied to Design §2–§4. *Files touched:* those 2 + their tests. 2 code items + 1 test item.
16. `spriteClient`/`pixelArtClient` (tests Design §5–§6): same assertions as test 15, plus: aborting during the sprite client's internal Replicate poll loop (`getReplicateStatus`, Design §5 line 286) stops further poll fetches; `removeBackground` (line 214) is covered by the signal-capture assertion only (single fetch, no loop).

**Dispatch 6 — route threading + end-to-end compose + docs + Boy-Scout leak fix.**
*Implements:* Design §7 (ALL 12 `web/src/app/api/generate/*/route.ts` files — a uniform one-line `signal: ctx.abortSignal` pass-through per route, plus `abortSignal: ctx.abortSignal` at the 2 `generateText` call sites; sprite-sheet/tileset-gen also gain the `ctx` third param), §11 (ADR follow-ups update), §12 (changeset), §13 (`voice/batch/route.ts:108` error-message hygiene). *Files touched:* 12 route files + `voice/batch/route.ts` + ADR + changeset + `route-integration.test.ts` + 1 new factory-compose test + the voice/batch test file. The 14 signal pass-throughs are one mechanical pattern counted as one item, verified per-route by test 17 — the builder must still touch all 14 sites; logical items: route sweep + 4 tests + ADR + changeset + leak fix = 7.
17. `route-integration.test.ts` (flag-on block; test-first for Design §7): assert each route's provider-client mock receives `ctx.abortSignal` (and the 2 LLM routes pass `abortSignal` to `generateText`). Implementation note: the provider clients are constructor mocks (`vi.fn(function (this) { this.method = vi.fn()... })`, `route-integration.test.ts:88–120`) — the method mocks live on constructed INSTANCES, not the module or prototype, so `vi.mocked(MeshyClient.prototype.createTextTo3D)` does not exist. Assert via the recorded instance: `vi.mocked(MeshyClient).mock.instances.at(-1)!.createTextTo3D.mock.calls[0]` and check the captured params carry the forwarded signal (use `.at(-1)` — the instance constructed by the request under test — since earlier tests in the file may also construct one). Do NOT restructure the existing mocks to prototype form; the 29 existing tests depend on the current shape.
18. Timeout-parity test *(regression pin — model/music already carry `maxDurationSeconds: 180` and localize `120`, so this passes against current code)*: for every route, the `maxDurationSeconds` passed to the factory matches the route file's exported `maxDuration` (locks the 180s/120s special cases; closes the derive-plumbing gap).
19. End-to-end compose *(regression pin — the timeout→`GenerationTimeoutError`→refund path shipped in #8833, so this passes against current code; its job is proving the path through the REAL factory, not the agent unit seam)*: flag-on route whose execute never resolves → `GenerationTimeoutError` fires at the derived deadline → `refundTokens` called → opaque 500. Implementation note: the factory's `runGenerationAgent` call (`createGenerationHandler.ts:278`) passes NO scheduler — the agent's injectable scheduler seam is unreachable from the factory, and the agent defaults to `globalThis.setTimeout` (`generationAgent.ts:143–145`). Fire the deadline with `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(stepTimeoutMs + 1)`; do NOT try to inject the scheduler through the factory (impossible without a code change this spec does not make) and do NOT use real wall-clock waits.
20. Voice/batch error hygiene (test-first for Design §13): a provider failure whose body contains a sentinel string → the sentinel appears in NO user-visible field of the batch response (`errors[].error` is the generic message) AND `captureException` receives the status/body detail. In the SAME commit as the §13 code change, update the ONE existing assertion the fix invalidates — `voice/batch/route.test.ts:222` in `records errors for failed items while completing others`: `expect(data.errors[0].error).toBe('Voice generation failed')` becomes `.toBe('Voice generation failed for this item')`. The old expected string is the raw `err.message` pass-through itself (the mock rejects with `new Error('Voice generation failed')`), i.e. the assertion pins the leak §13 removes — updating it to the constant is a strengthening change, not a weakening.

**Regression subsection — must pass unmodified (no weakening):** `route-integration.test.ts` (all 29 existing tests, both flag states), `createGenerationHandler.test.ts` (existing cases; only the Dispatch-1 mock-path line changes), `createGenerationHandler.qstash.test.ts` (run with QStash env unset), `generationAgent.test.ts`, `timeouts.test.ts`, `jobRecord.test.ts`, both `sentry-regressions.test.ts` files, `healthChecks` factory checks. `voice/batch/route.test.ts` is the ONE deliberate exception: exactly one expected-string assertion changes (line 222, per test 20 — it pins the leak §13 removes); every other assertion in that file must pass unmodified.

**Gate (before push, Node 24):** `cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && env -u UPSTASH_REDIS_REST_URL -u UPSTASH_REDIS_REST_TOKEN npx vitest run` plus `jq empty docs/api/openapi.json`.

## External prerequisites (owner-only — runbook, NOT set by this PR)

ADR rollout steps 2–3, unblocked once this PR merges:
1. Set `USE_GENERATION_AGENT=true` in Vercel **Preview** (scope `tnolan`, project `spawnforge`); exercise one generation per provider family on a preview deploy; watch Sentry (`tristan-nolan/spawnforge-ai`) for `GenerationTimeoutError` volume and generate-route 5xx rate.
2. After a clean canary window, set the same var in **Production**.
3. Revert path: unset the env var (exact-string semantics mean any other value is also OFF).

## Acceptance criteria (mapped from ticket, corrected)

1. *"Identical response contract incl. `usageId`"* — shipped by #8833 for 10 routes; COMPLETED here for all 12: sprite-sheet/tileset-gen return `usageId`, `route-integration.test.ts` green in both flag states, OpenAPI schemas updated.
2. *"Step/timeout caps enforced; runaway terminates deterministically"* — shipped by #8833 (wall-clock deadline + `GenerationTimeoutError` → refund); COMPLETED here at the provider layer: the abort now cancels the in-flight provider HTTP request/poll loop, proven by client-level and end-to-end compose tests. (Scope note: for async job-submission providers, an already-accepted server-side job may still complete after abort — pre-existing, inherent to async generation, and refund-neutral; the abort guarantees OUR compute and connections stop.)
3. *"Full integration tests across the generate routes pass"* — extended suite (Dispatches 1–6) green plus the unmodified regression set.
4. Rollout runbook documented (above); flag flip remains an owner action.
5. ADR follow-ups closed or ticketed: abort forwarding delivered; durable-polling leg → #8892; voice/batch remaining hardening → #8893 (with a clarifying comment posted); its error-message leak closed here with a pinning test (Design §13, test 20); ADR updated (Design §11).
6. The PR closes #8826; taskboard PF-916 → done after the user merges.

## Cross-spec coordination

- **`specs/2026-07-02-posthog-deep-generator-attribution.md` (#8877, PR #8891 open):** neither depends on nor blocks this spec. That spec forbids `createGenerationHandler` control-flow changes on its side; this spec changes no factory control flow either (all edits are inside route `execute` bodies, provider clients, and tests). `captureAiGeneration` in localize/pacing is untouched — adding `abortSignal` to `generateText` options does not alter telemetry fields.
- **`specs/PF-906-qstash-generation-callbacks.md` (#8816, shipped #8867):** dormancy invariants restated in Constraints §6 and pinned by Dispatch-2 test 7. The `usageId` addition feeds the same refund contract the QStash webhook uses; the webhook itself is untouched.
- **#8883 (AI SDK v6→v7 bump, PR open):** fully independent. If #8883 merges first, nothing here changes (`abortSignal` on `generateText` is identical in v7); if this merges first, #8883 stays version-only. No file overlap except `package-lock.json` non-overlap (this PR touches no manifest).
