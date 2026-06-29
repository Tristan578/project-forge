# Activating server-side LLM observability (PostHog `$ai_generation`, PF-907)

PostHog's [LLM observability](https://posthog.com/docs/ai-engineering/observability)
product renders per-generation **cost, token, latency, model, and error**
dashboards from a single event type: `$ai_generation`. Client-side analytics
(`posthog-js`) already captures product events; this feature adds the **server**
side — one `$ai_generation` event per LLM call on the routes that actually run a
model server-side.

It is wired into three self-contained capture sites (no change to the shared
`createGenerationHandler` factory — each route captures inside its own callback):

- `POST /api/chat` — one event per `onStepFinish` (streamed; carries Anthropic
  prompt-cache read/creation tokens).
- `POST /api/generate/localize` — one event per per-chunk `generateText`, all
  sharing a single trace id for the whole localize op.
- `POST /api/generate/pacing` — one event per `generateText`.

## Private by construction

The capture payload is built by `buildAiGenerationPayload()` in
`web/src/lib/analytics/posthog-server.ts`, which **never** includes the only two
`$ai_*` properties that hold prompt/response content — `$ai_input` and
`$ai_output_choices`. Only non-content metrics are sent: trace id, model,
provider, input/output tokens, latency (seconds), stream/error flags,
prompt-cache tokens, and a `route` label. The cost/token/latency/error
dashboards all render without the content fields. A unit test asserts the
serialized body contains neither content key.

We deliberately do **not** use `posthog-node` or the OpenTelemetry
`PostHogSpanProcessor`: Sentry owns the server OTel provider, and adding a
runtime dependency triggers the single-root-lockfile / Node-24-relock pain this
repo has hit repeatedly. Server LLM events are low-volume, so a dependency-free
`fetch` to PostHog's public capture endpoint is sufficient. See
`specs/2026-06-29-posthog-llm-observability.md` for the full rationale.

## Dormant by default

Capture is **fully dormant** until BOTH conditions hold — there is **no code
change** to activate it, only environment config:

1. `POSTHOG_LLM_CAPTURE` is exactly the string `"true"`, **and**
2. `NEXT_PUBLIC_POSTHOG_KEY` is set (the PostHog project key).

`isLlmCaptureEnabled()` gates every capture on both. Enabling client analytics
alone (`NEXT_PUBLIC_POSTHOG_KEY` without the dedicated server flag) does **not**
turn on server capture. While dormant, `captureAiGeneration()` is a no-op — no
`fetch`, no `after()` scheduling — so the routes behave exactly as before.

## Consent-gated (PF-30)

Independent of the dormancy lever, capture is suppressed unless the user has
consented to analytics. `CookieConsent.tsx` writes a server-readable cookie
`forge-cookie-consent=true|false` (in addition to its existing localStorage
flag) on accept/decline. Each route resolves consent with
`hasAnalyticsConsent()` (reads that cookie via `next/headers`) and passes
`consented` into `captureAiGeneration()`, which no-ops when it is not exactly
`true`. `hasAnalyticsConsent()` **fails closed** — outside a request scope, or if
the cookie store throws, it returns `false`.

## Activation steps (owner-only)

1. **Have a PostHog project.** `NEXT_PUBLIC_POSTHOG_KEY` is the project key from
   [PostHog → Project settings](https://us.posthog.com). If client analytics is
   already live, this is already set — confirm it is present in the `spawnforge`
   Vercel project.
2. **Set the server flag** in Vercel (Production **and** Preview) for the
   `spawnforge` project — scope `tnolan`:
   ```bash
   vercel env add POSTHOG_LLM_CAPTURE production --scope tnolan   # value: true
   vercel env add POSTHOG_LLM_CAPTURE preview --scope tnolan      # value: true
   ```
3. **Confirm the capture host.** The module posts to PostHog US cloud
   (`https://us.i.posthog.com/i/v0/e/`). If the project lives in EU cloud, change
   `CAPTURE_URL` in `posthog-server.ts` to the `eu.i.posthog.com` host (this is a
   code change, not an env var, because it is a constant).
4. **Redeploy.** `NEXT_PUBLIC_POSTHOG_KEY` is build-time; a redeploy is required
   for a changed value to take effect. `POSTHOG_LLM_CAPTURE` is read at request
   time but a redeploy is the clean way to roll the change.

## Verifying it is live

- With consent accepted, send a chat message (or run a localize/pacing
  generation), then open **PostHog → LLM observability**. A new `$ai_generation`
  event should appear within a minute, carrying token/latency/model/cost but no
  prompt or response text.
- Filter insights by the custom `route` property
  (`/api/chat`, `/api/generate/localize`, `/api/generate/pacing`) to attribute
  spend per surface.
- Decline cookies (or never accept) and confirm **no** `$ai_generation` events
  arrive — consent gating is working.
- Capture failures are silent to the user and reported to Sentry under `route:
  posthog_ai_capture` (`phase: schedule` if `after()` had no request scope,
  `phase: fetch` if the POST failed).

## Rolling back

Remove (or set to anything other than `"true"`) `POSTHOG_LLM_CAPTURE` in Vercel
and redeploy. Capture returns to fully dormant immediately — no `fetch`,
nothing scheduled. No data migration is involved.

## Coverage note

v1 instruments the three routes that run a model **directly** (`generateText` /
streamed chat). The deep generators that go through the `createGenerationHandler`
agent pipeline (GDD, world builder, cutscene, etc.) are **not** yet instrumented
— capturing their token usage cleanly needs a small adapter at the agent
boundary rather than per-route wiring. That follow-up is tracked separately so
this PR stays scoped to the direct-call routes.
