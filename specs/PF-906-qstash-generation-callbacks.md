# PF-906 (#8816) — Durable server-side generation callbacks via Upstash QStash

## Problem

Async asset generation (Meshy 3D/texture/skybox, Suno music, Replicate
sprite/sprite-sheet/tileset) is tracked entirely by a **client-side** poller
(`useGenerationPolling.ts`): a `setInterval` that hits the provider `/status`
route every 3s, capped at 100 polls (5 minutes). Two correctness holes:

1. **Refund depends on an open tab.** Token refund on a failed / timed-out /
   empty-artifact job is issued by the client poller (`triggerRefund` →
   `POST /api/generate/refund`). If the user closes the tab (or the laptop
   sleeps) the poll stops, the `generation_jobs` row is stranded in
   `processing`/`pending` forever, and **the user is never refunded for a job
   they paid for**.
2. **No server-side source of truth for terminal state.** Nothing finalizes a
   job unless a browser is watching it.

## Goal

Add a **durable, server-side** completion path that finalizes the
`generation_jobs` row and issues the refund-on-failure regardless of whether a
browser is open, using Upstash QStash to re-deliver a self-rescheduling
callback until the provider job reaches a terminal state.

## Hard constraint: DORMANT BY DEFAULT

No provider offers a native completion webhook, so we cannot register an
upstream callback. Instead the generation route, after submitting the provider
job, **publishes a QStash message to our own callback endpoint** with a delay;
the callback polls the provider and either finalizes or re-publishes itself.

Every change in this PR is **additive and env-guarded**:

- When `QSTASH_TOKEN` is unset, `isQstashConfigured()` is `false`, the factory
  publishes nothing, and the existing client poller remains the only path.
  Behavior is byte-for-byte identical to today.
- When configured, the durable path runs **in addition to** the client poller.
  `refundTokens()` is idempotent (unique partial index on
  `(user_id, operation, metadata->>'refundedUsageId')`), so a refund issued by
  both the client and the callback credits the user **at most once** — whichever
  fires first wins, the other no-ops.
- The callback only finalizes a row that is **still non-terminal**
  (`status NOT IN ('completed','failed','cancelled')`), so it never clobbers a
  result a live client already imported.

This makes the durable path safe to ship and enable independently of any client
change.

## Out of scope (explicit, deferred follow-up)

- **Collapsing the client 5-min poll loop / deduping the client `/api/jobs`
  POST.** Removing the client poller is a separate, independently-reviewable
  change that should land only after the durable path has soaked in production.
  Doing it in this PR would require refactoring a 529-line hook plus the store
  plus a new per-job status endpoint plus cross-file `dbId` threading — too much
  blast radius for one change, and the idempotent refund makes the overlap
  harmless in the meantime. Tracked as the next phase of PF-906.
- **`pixel-art` durable callbacks.** The `generation_type` Postgres enum does
  **not** include `pixel-art` (it is `model|texture|sfx|voice|skybox|music|
  sprite|sprite_sheet|tileset`), and neither does `/api/jobs` POST nor
  `createJobRecord`. Pixel-art has a status route but no DB row, so it cannot be
  durably tracked without an `ALTER TYPE ... ADD VALUE` migration. It keeps
  client-only polling. Adding it to the enum is a separate migration PR.

## Pollable async types (this PR)

The 7 `generation_type` enum members that (a) are async and (b) have a status
route: `model`, `texture`, `skybox`, `music`, `sprite`, `sprite_sheet`,
`tileset`. `sfx`/`voice` are synchronous (inline base64), `pacing`/`localize`
are synchronous LLM calls — none publish a callback.

## Design

### 1. `web/src/lib/qstash/client.ts` (new)

- `isQstashConfigured(): boolean` — `Boolean(process.env.QSTASH_TOKEN)`.
- `publishGenerationCallback(payload, { delaySeconds }): Promise<void>` — lazily
  constructs `new Client({ token })` and `publishJSON({ url, body, delay })`.
  No-op (returns) when not configured. URL =
  `${getAppBaseUrl()}/api/webhooks/generation-complete`.
- `verifyQstashSignature(body, signature): Promise<boolean>` — lazily constructs
  `new Receiver({ currentSigningKey, nextSigningKey })` and `.verify(...)`.
  Returns `false` when keys unset (fail closed) — a request that cannot be
  verified is rejected.
- Lazy construction means importing the module never throws on missing env, so
  the dormant import is safe everywhere (incl. the route-integration test).

### 2. `web/src/lib/generate/pollProviderStatus.ts` (new)

`pollProviderStatus(type, providerJobId, apiKey): Promise<NormalizedStatus>`
where `NormalizedStatus = { status: 'pending'|'processing'|'completed'|'failed';
progress: number; resultUrl?: string; resultMeta?: Record<string,string>;
succeededButEmpty: boolean; errorMessage?: string }`.

Replicates the **exact** mapping already in each `/status` route (including the
`succeededButEmpty → failed` guard from #8757) so the durable path and the
client path agree:

- `model` → `MeshyClient.getTaskStatus` (`SUCCEEDED`+`modelUrls.glb`→completed).
- `texture` → `MeshyClient.getTextureStatus` (`SUCCEEDED`+non-empty maps).
- `skybox` → `MeshyClient.getTextureStatus` (resultUrl = `Object.values(maps)[0]`).
- `music` → `SunoClient.getStatus` (`completed`/`succeeded`+audioUrl).
- `sprite`/`sprite_sheet`/`tileset` → `SpriteClient(apiKey,'sdxl').getReplicateStatus`
  (`succeeded`+`output[0]`).

### 3. `web/src/app/api/webhooks/generation-complete/route.ts` (new)

POST handler, mirrors the Stripe webhook idempotency pattern:

1. `const body = await req.text()` (raw — signature is over raw bytes).
2. Read `Upstash-Signature` header; `verifyQstashSignature(body, sig)` → 401 on
   fail. (Also 401 if `!isQstashConfigured()`.)
3. Parse payload `{ userId, providerJobId, type, tokenUsageId, attempt }`.
4. `resolveApiKey(userId, DB_PROVIDER[cap(type)], 0, 'status_check')` (same key
   the user's status route resolves — the payload carries `userId`).
5. `pollProviderStatus(type, providerJobId, apiKey)`:
   - **completed** → `updateJobStatusByProviderJob(...)` to `completed` +
     `resultUrl`/`resultMeta`, guarded on non-terminal. No refund. 200.
   - **failed** (incl. `succeededButEmpty`) → finalize row `failed` +
     `refundTokens(userId, tokenUsageId)`. 200.
   - **pending/processing** → if `attempt < MAX_ATTEMPTS`,
     `publishGenerationCallback({ ...payload, attempt: attempt+1 }, { delaySeconds })`
     (re-arm). Else treat as timeout → finalize `failed` + refund. 200.
6. Provider/poll throw → 500 so QStash retries with its own backoff (durable).

A missing row (tab closed before the client ever POSTed `/api/jobs`) is not an
error: the refund is keyed on `tokenUsageId`, not the row, so the critical action
still fires; the row update is best-effort (`UPDATE ... WHERE provider_job_id=…
AND user_id=… AND status NOT IN (terminal)` simply affects 0 rows).

Registered in `docs/api/openapi-internal-routes.json` under `webhook`.

### 4. `web/src/lib/api/createGenerationHandler.ts` (additive `asyncJob` config)

New optional config field — the factory cannot know the opaque `TResult` shape,
so the route declares how to extract the provider job id and which enum type it
is:

```ts
asyncJob?: {
  type: AsyncGenerationType;            // a generation_type enum member
  providerJobId: (result: TResult) => string | null; // null ⇒ synchronous, skip
  estimatedSeconds?: number;            // initial callback delay
};
```

After a **successful** non-cached execute, when `isQstashConfigured()` **and**
`asyncJob` present **and** `providerJobId(result)` non-null:
`publishGenerationCallback({ userId, providerJobId, type, tokenUsageId: usageId,
attempt: 0 }, { delaySeconds: estimatedSeconds ?? DEFAULT })`. Wrapped in
try/catch → a publish failure is logged to Sentry but **never** fails the user's
request (the response shape is unchanged; client polling still covers it). The
factory does **not** create a job row — the client already does, and the callback
finds-or-retries by `providerJobId`, avoiding a duplicate row.

Async routes wired (`asyncJob` added, no response-shape change): model, texture,
skybox, music, sprite, sprite-sheet, tileset-gen.

## Test plan

- `web/src/lib/qstash/__tests__/client.test.ts` — `isQstashConfigured` true/false;
  publish no-ops when unconfigured; publish calls `publishJSON` with the right
  url/body/delay when configured; verify returns false when keys unset; verify
  delegates to `Receiver.verify`.
- `web/src/lib/generate/__tests__/pollProviderStatus.test.ts` — for each of the 7
  types: completed-with-artifact, succeeded-but-empty→failed, provider-failed,
  in-progress→processing. Asserts the normalized shape matches the corresponding
  `/status` route (parity, no drift).
- `web/src/app/api/webhooks/generation-complete/__tests__/route.test.ts` — bad
  signature→401; unconfigured→401; completed→row finalized + no refund; failed→
  row finalized + refund; still-processing under cap→re-publish; over cap→
  failed+refund; provider throw→500.
- `web/src/lib/api/__tests__/createGenerationHandler.qstash.test.ts` — publish
  called once on success when configured + asyncJob present; NOT called when
  unconfigured; NOT called when `providerJobId` returns null; publish failure
  does not change the 201 response.
- Regression (must stay green, unchanged): `route-integration.test.ts`,
  `createGenerationHandler.test.ts`, `jobRecord.test.ts`. These run with
  `QSTASH_TOKEN` unset, so the factory's publish block is inert.

## External prerequisites (owner-only — runbook, NOT set by this PR)

Set in Vercel (Production + Preview) before enabling:
- `QSTASH_TOKEN`
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`

Until all three are set, the feature is dormant. The callback endpoint must be
publicly reachable (it is — `/api/webhooks/*` is unauthenticated and verified by
signature, same as the Stripe webhook).
