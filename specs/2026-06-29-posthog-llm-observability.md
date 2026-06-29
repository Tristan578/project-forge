# PostHog LLM Observability (`$ai_generation`)

- **Ticket:** PF-907 / #8817
- **Milestone:** E3: Instrumentation & Growth Metrics
- **Status:** Spec — dormant-by-default, reviewer-gated
- **Author:** Engineering
- **Date:** 2026-06-29

## Problem

We have zero per-generation observability on our LLM calls. Token spend, latency,
model mix, and error rate for the AI chat tool-loop and the text-generation routes
are invisible outside of (a) the billing `costLog` table (chat-only, no latency,
no model breakdown) and (b) Sentry AI spans (which we keep **content-free** and do
not aggregate into product dashboards). PostHog ships a first-class **LLM analytics**
product keyed on a single event — `$ai_generation` — that renders cost / token /
latency / model / error dashboards and a per-trace view. We already ship
`posthog-js` on the client; the server emits nothing.

## Goal

Emit a privacy-safe `$ai_generation` event for each server-side LLM generation on
our AI-SDK **text** call paths, so PostHog LLM analytics can chart cost, tokens,
latency, model, and error rate per route — **without ever sending prompt or
response content**, **gated on cookie consent (PF-30)**, and **fully dormant until
an owner sets one env var** (no code change to activate).

Non-goals (this PR): media generation routes (Meshy/Suno/Replicate are HTTP jobs,
not LLM generations — they have no token usage and do not belong on `$ai_generation`);
the deep-generation routes that flow through `aiSdkAdapter`/`createSpawnforgeAgent`
(GDD/world/cutscene) — see **Deferred** below; client-side `$ai_*` capture; session
replay / flags / experiments.

## Architecture decision — manual `fetch` capture, NOT the OTel span processor

The ticket was written from PostHog's docs and named the
`PostHogSpanProcessor` (`@posthog/ai` + an OpenTelemetry `NodeSDK` in
`instrumentation.ts`). During spec investigation that approach was found to conflict
with our current stack, so this spec **deviates deliberately** and documents why.
Reviewers should scrutinize this section.

### Why not the OTel `PostHogSpanProcessor`

1. **Sentry already owns the server OTel provider.** `@sentry/nextjs` installs its
   own `NodeTracerProvider` with a `SentrySampler` / `SentryPropagator` /
   `SentrySpanProcessor`. Adding PostHog's processor means either
   `skipOpenTelemetrySetup: true` + manually rebuilding the provider with BOTH
   vendors' samplers/propagators, or letting two SDKs fight over the global
   provider. Either path destabilizes the existing, working Sentry AI spans. The
   manual path has **zero** interaction with the OTel provider.
2. **No processor-level privacy knob.** The only content toggle on the span path is
   the AI-SDK `experimental_telemetry.recordInputs/recordOutputs`, which **also**
   feeds Sentry spans — flipping it to satisfy PostHog would change Sentry's data
   collection too. The manual path is **private by construction**: we build the
   event body ourselves and simply never include the content fields.
3. **Smaller dependency surface.** The OTel path pulls `@posthog/ai` +
   `@opentelemetry/sdk-node` + `@opentelemetry/resources`. The manual path needs
   **no new dependency at all** — `$ai_generation` is captured with a single `fetch`
   to PostHog's public capture endpoint. This matters disproportionately here: this
   repo has a **single-root `package-lock.json`** and a history of new/changed deps
   breaking `npm ci` on main (the `Lockfile Sync` gate, the Node-24 relock dance).
   Zero new deps = zero relock = zero gate exposure.
4. **Data is already in hand.** At every finalize hook we already have
   `usage.inputTokens` / `usage.outputTokens` and the resolved model id. The span
   path would re-derive the same numbers from a span we'd have to wire up anyway.

### The manual path

PostHog's capture API is a public, project-token POST endpoint
(`https://us.i.posthog.com/i/v0/e/`, body `{ api_key, event, distinct_id,
properties, timestamp }`). LLM analytics is documented to populate from a manually
captured `$ai_generation` event — it is a first-class, supported path, not a hack.
Server-side LLM events are low-volume (one per chat step / generate call), so we do
not need `posthog-node`'s batching/retry/shutdown machinery; a fire-after-response
`fetch` is sufficient and simpler to keep dormant.

**OTel path is documented as a future upgrade**, not discarded: if we later want
full distributed AI tracing that ties PostHog and Sentry to the same trace id, the
processor approach is revisited as its own spec once the Sentry-provider-ownership
question is designed for. `sentry.server.config.ts` already pins
`streamGenAiSpans: false` with a comment deferring the opt-in to "the dedicated
LLM-observability work" — i.e. this ticket. We are NOT flipping that flag here; the
manual path is orthogonal to Sentry's spans.

## Privacy & consent (PF-30 — hard requirement)

- **No content, ever.** We never send `$ai_input` or `$ai_output_choices` (the only
  `$ai_*` props that carry prompt/response text). We send only: `$ai_trace_id`,
  `$ai_model`, `$ai_provider`, `$ai_input_tokens`, `$ai_output_tokens`,
  `$ai_latency` (seconds — `localize`/`pacing` only; omitted on the chat path,
  where per-`onStepFinish`-step latency is not meaningful), `$ai_stream`,
  `$ai_is_error`, plus non-content custom props (`route`, optional
  `$ai_cache_read_input_tokens` / `$ai_cache_creation_input_tokens` from the chat
  path where we already read them).
  The cost/token/latency/model/error dashboards all render from these; only the
  per-trace conversation drill-down (which shows message text) is intentionally
  blank — an accepted privacy tradeoff.
- **`distinctId`** is the Clerk user id (already the identifier we bill on). No PII
  beyond the id we already store.
- **Consent gate.** PF-30 requires PostHog tracking to be gated behind cookie
  consent. Today consent lives **only in `localStorage`** (`CookieConsent.tsx`
  writes `forge-cookie-consent` to `localStorage`, never to a cookie), so the
  **server cannot see it**. This spec closes that gap:
  - `CookieConsent.tsx` ALSO writes a server-readable cookie
    `forge-cookie-consent=true|false` (non-`HttpOnly` so the client keeps managing
    it, `SameSite=Lax`, `path=/`, ~1-year max-age) on accept/decline.
  - A server util `hasAnalyticsConsent()` reads that cookie via `next/headers`
    `cookies()` and returns `true` only when its value is exactly `'true'`.
  - `captureAiGeneration` is a no-op unless `consented === true`. **No consent
    cookie → no event.** (Strictest PF-30 reading: absence is not consent.)

## Dormancy (mirrors QStash / PF-906)

Capture is **off** until BOTH are true at runtime:

- `process.env.POSTHOG_LLM_CAPTURE === 'true'` (a NEW dedicated flag), **and**
- a project key is present (`NEXT_PUBLIC_POSTHOG_KEY`).

A dedicated flag (rather than reusing the client `NEXT_PUBLIC_POSTHOG_KEY` alone)
means **enabling client analytics does NOT silently turn on server LLM capture** —
the two are independently switched. There is **no code change** to activate: set the
env var in Vercel (Production/Preview, scope `tnolan`) and redeploy. Unset it →
fully dormant again. This matches the PF-906 QStash dormancy contract exactly.

## Touch points (v1)

`logCost` is **chat-route-only**, so it is not a universal chokepoint; capture wires
at each finalize site through one shared helper. All three sites already pass
`experimental_telemetry: { isEnabled: true }` (Sentry) — the manual capture is
orthogonal and needs no telemetry-metadata change.

| # | File | Hook | Notes |
|---|------|------|-------|
| 1 | `web/src/app/api/chat/route.ts` | `agent.stream({ onStepFinish })` | One `$ai_generation` per tool-loop step. `usage` + `userId` already in scope; resolve `consented` once at the top of the handler (pre-stream) and pass it in. |
| 2 | `web/src/app/api/generate/localize/route.ts` | inside `execute`, after each `generateText` | `ctx.userId` is passed by the factory (route just doesn't destructure it today); `generateText` returns `usage`. |
| 3 | `web/src/app/api/generate/pacing/route.ts` | inside `execute`, after `generateText` | same shape as localize. |

The `createGenerationHandler` factory is the documented SPOF ("all generate routes
use this factory; a bug breaks every route"). We **do not modify it** — capture
lives inside each route's own `execute`, reading the `ctx.userId` the factory
already provides. Zero blast radius on the other ~10 generate routes.

## New / changed files

- **`web/src/lib/analytics/posthog-server.ts`** (new) — server capture module:
  - `isLlmCaptureEnabled(): boolean` — `POSTHOG_LLM_CAPTURE === 'true'` && key present.
  - `hasAnalyticsConsent(): Promise<boolean>` — reads `forge-cookie-consent` cookie via
    `next/headers`; returns `false` (fail-closed) if there is no request scope.
  - `buildAiGenerationPayload(input): Record<string, unknown> | null` — **pure**,
    unit-testable; returns the capture body with ONLY non-content `$ai_*` props, or
    `null` when dormant. The privacy guarantee is asserted here (no content keys).
  - `captureAiGeneration(input): void` — no-op unless enabled + `input.consented`;
    builds payload; fires the POST via `after()` (post-response, survives serverless
    freeze) wrapped in try/catch → `captureException` on error. **Never throws.**
- **`web/src/components/CookieConsent.tsx`** (edit) — on accept/decline ALSO write
  the server-readable `forge-cookie-consent` cookie (in addition to the existing
  `localStorage` write + `initPostHog()` + storage event). No behavior change to the
  client path.
- **3 route edits** (chat, localize, pacing) — one `captureAiGeneration(...)` call
  each at the finalize hook; resolve `consented`/`distinctId` per the table above.
- **`docs/guides/posthog-llm-observability.md`** (new) — owner runbook:
  activation (`POSTHOG_LLM_CAPTURE`), verification (dashboard + a probe), privacy
  guarantee, consent dependency, rollback. Mirrors `docs/guides/qstash-setup.md`.
- **`.changeset/<name>.md`** — patch/minor for `web`.

## Test plan (Test-First)

New `web/src/lib/analytics/__tests__/posthog-server.test.ts`:

- **Dormancy:** `buildAiGenerationPayload` returns `null` and `captureAiGeneration`
  fires no `fetch` when `POSTHOG_LLM_CAPTURE` ≠ `'true'`, when the key is absent, and
  when `consented === false`. (Each independently.)
- **Privacy (the core assertion):** when enabled+consented, the payload contains
  `$ai_input_tokens`/`$ai_output_tokens`/`$ai_model`/`$ai_provider`/`$ai_trace_id`/
  `$ai_latency` and **NOT** `$ai_input` nor `$ai_output_choices` — assert the keys
  are absent, and assert no payload value equals a sentinel prompt/response string
  passed in.
- **Shape:** event name is exactly `$ai_generation`; `distinct_id` is the passed
  user id; `api_key` is the project token; endpoint is `…/i/v0/e/`.
- **Fail-safe:** a rejected `fetch` does not throw out of `captureAiGeneration`
  (assert it resolves and `captureException` was called).
- **Consent util:** `hasAnalyticsConsent` true only for cookie value exactly
  `'true'`; false for `'false'`, missing, and when `cookies()` throws (no scope).

Route-level: extend the existing chat-route and localize/pacing tests with a case
asserting `captureAiGeneration` is invoked once per step / per call when enabled, and
zero times when dormant. (Mock `posthog-server`; do not hit the network.)

Local gate (Node 24): `eslint --max-warnings 0`, `tsc --noEmit`, and targeted
`vitest run` for the new + touched test files. No full suite (M2).

## Acceptance criteria

1. With `POSTHOG_LLM_CAPTURE` unset, **no** `$ai_generation` `fetch` is issued from
   any of the three paths, and response shapes are byte-for-byte unchanged.
2. With the flag set, a key present, and consent cookie `= 'true'`, each chat step
   and each localize/pacing call issues exactly one `$ai_generation` POST to
   `…/i/v0/e/` carrying tokens/model/provider/latency/trace-id and **no content**.
3. With consent cookie absent or `'false'`, no event is issued even when the flag is
   set.
4. A `fetch` failure never surfaces to the user and never fails the request; it is
   reported to Sentry.
5. New tests cover dormancy, privacy (no-content), consent gating, and fail-safe;
   `eslint`/`tsc`/targeted `vitest` all green on Node 24.
6. Owner runbook documents activation, verification, privacy, consent, and rollback.

## Deferred (tracked, not gaps)

- **Deep-generation routes** (GDD / world / cutscene via `aiSdkAdapter` /
  `createSpawnforgeAgent`): same helper applies, but wiring requires threading
  `userId` + `consented` through the shared adapter signature (touches multiple
  callers). Kept out of this PR to bound blast radius; tracked in #8877
  (fix-it-or-track-it).
- **OTel `PostHogSpanProcessor`** distributed-trace upgrade: revisit once the
  Sentry-provider-ownership design is done (see Architecture decision).

## Review board

Touches a new server analytics module + production routes + a consent change + a
runbook → **7 reviewers**: the 5 specialized (architect, security, dx, ux, test) +
`infra-devops` (env-gated production capture, dormancy) + `docs-guardian` (runbook).
PASS or FAIL only; loop until all clean. Orchestrator owns the board.

## PR

Stacked on the #8816 branch (`feat/qstash-generation-callbacks-8816`) per the agreed
Wave-2 sequencing. `Closes #8817 (PF-907)`, `--milestone "E3: Instrumentation &
Growth Metrics"`, changeset included. As a stacked PR it gets **no `ci.yml` run**
until #8816 merges and the base rebases to main — verified instead by the local
Node-24 gate + a post-merge CI re-check. **Do not merge** — user reviews and merges.
