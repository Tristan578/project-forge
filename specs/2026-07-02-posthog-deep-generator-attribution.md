# Spec: Per-surface attribution for deep-generator `$ai_generation` events (PF-DEEP-LLM-ATTR)

**Ticket:** #8877 (taskboard 01KWAVZ8E53GHX8SMH3A8MEHV9)
**Parent spec:** `specs/2026-06-29-posthog-llm-observability.md` (#8817 / PF-907)
**Milestone:** E3: Instrumentation & Growth Metrics

## Corrected premise (supersedes the ticket description)

The ticket assumed the deep generators (GDD, world builder, cutscene) run their model
calls through `createGenerationHandler` and are therefore *not* captured. Code
inspection shows otherwise:

1. `web/src/lib/ai/gddGenerator.ts` (`generateGDD`), `web/src/lib/ai/worldBuilder.ts`,
   and `web/src/lib/ai/cutsceneGenerator.ts` are **client-side** modules. Each calls
   `fetchAI(...)` (`web/src/lib/ai/client.ts:102`) with
   `model: getDeepGenerationModel(<surface>)` + a `systemOverride`, which POSTs to
   `/api/chat`.
2. `/api/chat` already emits a content-free `$ai_generation` per call (#8817) via
   `captureAiGeneration` (`web/src/app/api/chat/route.ts:659`), so deep-generator
   token/cost/latency IS captured today — but with the hardcoded label
   `route: '/api/chat'`, indistinguishable from interactive chat traffic.
3. `createGenerationHandler` routes (`/api/generate/model|music|sfx|skybox|...`) are
   non-LLM asset providers (Meshy, Suno, ElevenLabs, Replicate). There is no LLM
   generation there to capture; the two LLM routes under `/api/generate/`
   (localize, pacing) were already instrumented directly by #8817.

**The real gap is attribution, not capture**: PostHog cannot answer "what does GDD
generation cost vs. chat?" because every deep-generator event is labeled
`/api/chat`. This spec closes that gap. No adapter inside `createGenerationHandler`
is needed or appropriate (it must not grow LLM-observability concerns — see PF-916,
which is *retiring* that factory's SPOF status).

## Design

Flow a validated, enum-constrained `surface` label from the deep-generator client
modules through the `/api/chat` request body into the existing capture call.

### 1. Client — `web/src/lib/ai/client.ts`
- Add `surface?: DeepGenSurface` to `AIClientOptions` (type imported from the
  shared leaf module below). When present, include `surface` in the `/api/chat`
  POST body using the conditional-spread idiom the body already uses for
  `effort`/`systemOverride` (`client.ts:149-156`) — callers that pass no surface
  produce byte-identical bodies to today. (Both `fetchAI`/`fetchAIUncached` and
  `streamAI` if trivially shareable — scope minimum is the non-streaming path
  the deep generators use.)
- Include `surface` in the response-cache key alongside `model`/`effort` — two
  surfaces sharing a prompt must not cross-contaminate labels. (Cache key today:
  `computeKey`, `client.ts:119`.)

### 2. Shared surface allowlist — new leaf module `web/src/lib/ai/surfaces.ts`
- `DeepGenSurface` (`'gdd' | 'world_builder' | 'cutscene'`) exists today only as
  a **type alias** (`deepTier.ts:17`) — types are erased at runtime, so the wire
  allowlist cannot literally be "derived from the type". A runtime `as const`
  array must be the source and the type derived from it.
- The array cannot live in `deepTier.ts`: that module value-imports `trackEvent`
  from the client-side analytics module (`deepTier.ts:14`), so a value import
  from the server route would pull client analytics code into the server bundle.
- Therefore create a dependency-free leaf module `web/src/lib/ai/surfaces.ts`:
  ```ts
  export const DEEP_GEN_SURFACES = ['gdd', 'world_builder', 'cutscene'] as const;
  export type DeepGenSurface = (typeof DEEP_GEN_SURFACES)[number];
  ```
- `deepTier.ts` replaces its local alias with
  `export type { DeepGenSurface } from './surfaces';` — its existing importers
  (the three generators) keep working unchanged.
- The route imports the `DEEP_GEN_SURFACES` value from the leaf module only;
  `client.ts` imports the type only. Single source of truth, no duplicated
  union, no client analytics in the server bundle.

### 3. Deep generators — pass their surface
- `gddGenerator.ts:350` → `surface: 'gdd'`
- `worldBuilder.ts` (its `fetchAI` call) → `surface: 'world_builder'`
- `cutsceneGenerator.ts` (its `fetchAI` call) → `surface: 'cutscene'`

### 4. Server — `web/src/app/api/chat/route.ts`
- Extend the parsed body type (~line 318) with `surface?: string`.
- Validate using the repo's manual-validation convention (typeof + allowlist,
  matching the route's existing body checks — no Zod here):
  ```ts
  import { DEEP_GEN_SURFACES, type DeepGenSurface } from '@/lib/ai/surfaces';

  const surface: DeepGenSurface | undefined =
    typeof body.surface === 'string' &&
    (DEEP_GEN_SURFACES as readonly string[]).includes(body.surface)
      ? (body.surface as DeepGenSurface)
      : undefined;
  ```
  Anything else (wrong type, unknown value, empty string) → treated as absent.
  Never reject the request over it (additive, non-breaking), never echo the raw
  value back in an error or response.
- In the `captureAiGeneration` call (route.ts:659): keep
  `route: '/api/chat'` and add the surface as the event's route qualifier:
  `route: surface ? `/api/chat#${surface}` : '/api/chat'`.
- Why the `#` form is safe: `route` is a plain, non-`$` custom property —
  `buildAiGenerationPayload` emits it verbatim (`posthog-server.ts:113`,
  `route: input.route`). PostHog stores custom property values as opaque
  strings and applies no URL/fragment parsing to them, so `#` carries no
  special semantics; it is simply a separator that cannot collide with a real
  route path. This keeps one dashboard dimension (`route`) instead of adding a
  second custom prop; existing insights filtering on prefix/contains
  `/api/chat` keep working. Insights using EXACT equality
  (`route = '/api/chat'`) will stop matching deep-generator events — that is
  the purpose of this change (separating the traffic), not a regression; the
  runbook update (§5) documents it.
- The label is server-validated enum data — content-free by construction; the
  privacy invariant (`$ai_input`/`$ai_output_choices` never sent) is untouched
  because `buildAiGenerationPayload` is not modified.

### 5. Runbook — `docs/guides/posthog-llm-observability.md`
- The `## Coverage note` section (line 105) currently reads:
  > v1 instruments the three routes that run a model **directly** (`generateText` /
  > streamed chat). The deep generators that go through the `createGenerationHandler`
  > agent pipeline (GDD, world builder, cutscene, etc.) are **not** yet instrumented
  > — capturing their token usage cleanly needs a small adapter at the agent
  > boundary rather than per-route wiring. That follow-up is tracked in #8877 so
  > this PR stays scoped to the direct-call routes.
- Both load-bearing claims are stale (see Corrected premise): the deep
  generators do NOT go through `createGenerationHandler`, and their usage IS
  captured today (unlabeled). Replace the section body to state: the deep
  generators call `/api/chat` from client modules and are captured with
  per-surface labels (`/api/chat#gdd`, `/api/chat#world_builder`,
  `/api/chat#cutscene`); insights using exact equality on
  `route = '/api/chat'` exclude them by design; #8877 delivered this change
  (it is no longer a pending follow-up, and no agent-boundary adapter exists
  or is needed).

## Explicitly out of scope
- Any change to `createGenerationHandler` / `generationAgent` (PF-916 / #8826
  owns that; it is open and independently sequenced — nothing here depends on
  or blocks it).
- Capturing non-LLM asset generations as `$ai_generation` (wrong event semantics).
- `posthog-node` / OTel span processors (parent spec's standing decision).
- Streaming chat UI surface labels beyond what falls out of the shared option.

## Constraints (inherited from `specs/2026-06-29-posthog-llm-observability.md`, restated in full so this spec is self-contained — must hold)
- Never send `$ai_input` / `$ai_output_choices`.
- Dormant by default (`POSTHOG_LLM_CAPTURE !== 'true'` → no behavior change).
- Consent-gated via `hasAnalyticsConsent()`; fails closed.
- Fired via `after()`; capture failure swallowed to Sentry — both already
  enforced inside `captureAiGeneration`, which this spec does not modify.
- No `createGenerationHandler` control-flow changes (SPOF rule).

## Test plan (test-first)
Failing tests written before implementation. All files below run in the node
environment (`vitest.config.node.ts`); mock via `@/lib/...` aliases only (repo
mock rule — never relative paths in `vi.mock`).

1. `web/src/app/api/chat/__tests__/route.test.ts` — mock the capture module with
   `vi.mock('@/lib/analytics/posthog-server')`; every assertion below targets
   the capture ARGUMENT, `vi.mocked(captureAiGeneration).mock.calls[0][0]`:
   (a) parametrized over ALL THREE surfaces
       (`test.each([...DEEP_GEN_SURFACES])`): request with `surface: s` →
       capture called with `route: '/api/chat#' + s`. A single-value test
       cannot catch an allowlist that omits `world_builder` or `cutscene`;
   (b) unknown `surface: 'evil<script>'` → capture called with
       `route: '/api/chat'` AND
       `JSON.stringify(vi.mocked(captureAiGeneration).mock.calls[0][0])`
       does not contain the raw string; additionally assert the HTTP response
       body does not echo it;
   (c) absent surface → unchanged `route: '/api/chat'` (regression);
   (d) the capture argument passed by the route still carries no
       `$ai_input`/`$ai_output_choices`-bearing fields — this is the
       route-integration guard; the payload-construction guarantee itself is
       already unit-covered by
       `web/src/lib/analytics/__tests__/posthog-server.test.ts` (which this
       spec does not modify).
2. `web/src/lib/ai/__tests__/client.test.ts`: `fetchAI({surface})` puts
   `surface` in the POST body; callers passing no surface produce
   byte-identical bodies and cache keys to today; cache keys DIFFER for
   identical prompts with different surfaces (isolation) and MATCH for
   identical prompts with the same surface (dedup still works).
3. All three deep-generator test files (not just one — two of three generators
   untested is a real allowlist/wiring escape):
   - `web/src/lib/ai/__tests__/gddGenerator.test.ts` — mocks `@/lib/ai/client`
     (line 14); assert the `fetchAI` call options include `surface: 'gdd'`.
   - `web/src/lib/ai/__tests__/cutsceneGenerator.test.ts` — mocks
     `@/lib/ai/client` (line 202); assert `surface: 'cutscene'` the same way.
   - `web/src/lib/ai/__tests__/worldBuilder.test.ts` — NOTE: this file stubs
     GLOBAL `fetch` (`vi.stubGlobal('fetch', ...)`, line 345) and exercises the
     real client code, so assert on the outgoing request instead:
     `JSON.parse(vi.mocked(fetch).mock.calls[0][1].body)` contains
     `surface: 'world_builder'`.
4. Regression: the #8817 suite
   `web/src/lib/analytics/__tests__/posthog-server.test.ts` (covering
   `buildAiGenerationPayload` / `captureAiGeneration`) must pass unmodified —
   no weakening.

## Acceptance criteria (mapped from ticket, corrected)
- Each of the three deep generators emits its `$ai_generation` with a
  surface-qualified `route` label when capture is enabled + consented, carrying
  the same token/latency/model/provider fields as today.
- Unknown/malformed `surface` values are dropped server-side and never enter the
  analytics payload.
- Dormant/unconsented behavior unchanged (existing tests prove it).
- Runbook coverage note corrected + updated.
- Ticket #8877 description updated with the corrected architecture note.
