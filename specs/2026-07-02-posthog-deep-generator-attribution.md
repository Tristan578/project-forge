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
- Add `surface?: AiSurface` to `AIClientOptions` (type re-exported from the shared
  module below). When present, include `surface` in the `/api/chat` POST body
  (both `fetchAI`/`fetchAIUncached` and `streamAI` if trivially shareable — scope
  minimum is the non-streaming path the deep generators use).
- Include `surface` in the response-cache key alongside `model`/`effort` — two
  surfaces sharing a prompt must not cross-contaminate labels. (Cache key today:
  `client.ts:119`.)

### 2. Shared surface enum — `web/src/lib/ai/deepTier.ts`
- `DeepGenSurface` (`'gdd' | 'world_builder' | 'cutscene'`) already exists
  (`deepTier.ts:17`). Derive the wire allowlist from it — single source of truth;
  do NOT duplicate a string union in the route.

### 3. Deep generators — pass their surface
- `gddGenerator.ts:350` → `surface: 'gdd'`
- `worldBuilder.ts` (its `fetchAI` call) → `surface: 'world_builder'`
- `cutsceneGenerator.ts` (its `fetchAI` call) → `surface: 'cutscene'`

### 4. Server — `web/src/app/api/chat/route.ts`
- Extend the parsed body type (~line 318) with `surface?: string`.
- Validate: accept only exact members of the `DeepGenSurface` allowlist; anything
  else (wrong type, unknown value, empty) → treat as absent. Never reject the
  request over it (additive, non-breaking), never echo it back in an error.
- In the `captureAiGeneration` call (route.ts:659): keep
  `route: '/api/chat'` and add the surface as the event's route qualifier:
  `route: surface ? `/api/chat#${surface}` : '/api/chat'`.
  Rationale: keeps one dashboard dimension (`route`) rather than a second custom
  prop; existing insights filtering on prefix `/api/chat` keep working. The `#`
  form cannot collide with a real route path.
- The label is server-validated enum data — content-free by construction; the
  privacy invariant (`$ai_input`/`$ai_output_choices` never sent) is untouched
  because `buildAiGenerationPayload` is not modified.

### 5. Runbook — `docs/guides/posthog-llm-observability.md`
- Update the "Coverage note" to state deep generators are captured with per-surface
  labels (`/api/chat#gdd`, `/api/chat#world_builder`, `/api/chat#cutscene`) and
  correct the stale claim that they were uncaptured.

## Explicitly out of scope
- Any change to `createGenerationHandler` / `generationAgent` (PF-916 owns that).
- Capturing non-LLM asset generations as `$ai_generation` (wrong event semantics).
- `posthog-node` / OTel span processors (parent spec's standing decision).
- Streaming chat UI surface labels beyond what falls out of the shared option.

## Constraints (inherited from parent spec — must hold)
- Never send `$ai_input` / `$ai_output_choices`.
- Dormant by default (`POSTHOG_LLM_CAPTURE !== 'true'` → no behavior change).
- Consent-gated via `hasAnalyticsConsent()`; fails closed.
- Fired via `after()`; capture failure swallowed to Sentry — both already
  enforced inside `captureAiGeneration`, which this spec does not modify.
- No `createGenerationHandler` control-flow changes (SPOF rule).

## Test plan (test-first)
Failing tests written before implementation:
1. `web/src/app/api/chat/__tests__` (or the existing chat route test file):
   (a) request with `surface: 'gdd'` → capture called with `route: '/api/chat#gdd'`;
   (b) unknown `surface: 'evil<script>'` → capture called with `route: '/api/chat'`
       and the raw value appears NOWHERE in the serialized payload;
   (c) absent surface → unchanged `route: '/api/chat'` (regression);
   (d) payload still contains no `$ai_input`/`$ai_output_choices` keys.
2. `web/src/lib/ai/__tests__/client.test.ts`: `fetchAI({surface})` puts `surface`
   in the POST body; cache keys differ for identical prompts with different surfaces.
3. One deep-generator test (`gddGenerator`): `generateGDD` passes `surface: 'gdd'`.
4. Existing #8817 tests must pass unmodified (no weakening).

## Acceptance criteria (mapped from ticket, corrected)
- Each of the three deep generators emits its `$ai_generation` with a
  surface-qualified `route` label when capture is enabled + consented, carrying
  the same token/latency/model/provider fields as today.
- Unknown/malformed `surface` values are dropped server-side and never enter the
  analytics payload.
- Dormant/unconsented behavior unchanged (existing tests prove it).
- Runbook coverage note corrected + updated.
- Ticket #8877 description updated with the corrected architecture note.
