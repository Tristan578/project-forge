# Generation agent: retiring the createGenerationHandler SPOF

- **Status:** Adopted (flag-gated, default off)
- **Ticket:** PF-916 / #8826
- **Milestone:** S1: Quality & Reliability
- **Flag:** `USE_GENERATION_AGENT` (server env; not `NEXT_PUBLIC_`)

## Context

`createGenerationHandler` is the documented single point of failure behind all
12 `/api/generate/*` routes — a bug in its loop breaks every generate route. The
factory had no deterministic termination guarantee around the provider
`execute`: a hung provider call could outlive the function `maxDuration`, leave
a token deduction stranded, and only refund via a generic timeout.

## What we did (and explicitly did NOT do)

The generate routes' `execute` is a **single deterministic provider HTTP call**
(ElevenLabs / Meshy / Replicate / Suno), not an LLM tool loop. A literal
`ToolLoopAgent` from the AI SDK requires a `model` + `tools` and drives an LLM —
wrapping a deterministic provider call in it would invent a fake model, add LLM
cost where there is none, and change the response semantics. So `runGenerationAgent`
(`web/src/lib/api/generationAgent.ts`) is an **honest single-step executor**:

- One provider call IS the whole job — there is no second step, no intermediate
  state, and no LLM to drive — so the runner does not pretend to loop. (An earlier
  iteration wrapped the call in a `stepCountIs`-bounded loop that provably never
  iterated; that dead machinery was removed.) If a route ever grows a genuine
  multi-step LLM loop, that belongs in a real `ToolLoopAgent`, not here.
- The single step races against a hard wall-clock deadline using an `AbortSignal`
  (the SDK's native cancellation primitive). On timeout the step is aborted and
  the caller's existing refund path runs while the function is still alive.

**Per-route enforceable timeout.** The step's wall-clock cap is *derived from each
route's `maxDuration`* by `deriveGenerationStepTimeoutMs`
(`web/src/lib/config/timeouts.ts`): `min(base cap, maxDuration*1000 - buffer)`.
This fixes a bug where the base cap was `150_000` (150s) — larger than the 60s
`maxDuration` of ~10 of the 13 routes — so the abort could never fire on them
(Vercel killed the function first). The base cap is now pinned below the standard
60s route's budget minus a 5s buffer (`55_000`), and heavy routes (model, music =
180s; localize = 120s) pass their `maxDurationSeconds` so the cap is derived
against their real budget. The buffer guarantees the abort + refund run before the
function is killed on every route.

The factory keeps owning auth, rate limiting, billing, `usageId` resolution, and
refund-on-failure. The runner never reshapes the result, so the response shape,
`usageId` (for async refunds), and the provider-success-with-no-artifact ->
`failed` mapping (which lives in each route's `execute`) flow through untouched.

## Rollout

1. **Default off.** With `USE_GENERATION_AGENT` unset or any value other than the
   exact string `"true"`, `createGenerationHandler` runs the legacy inline path
   byte-for-byte. Mirrors the `hasValidClerkKey` / `NEXT_PUBLIC_USE_DEEP_GENERATION`
   guard pattern: a missing env var can never break CI or prod.
2. **Canary.** Set `USE_GENERATION_AGENT=true` in a preview / staging Vercel
   environment. The full generate-route integration suite
   (`web/src/app/api/generate/__tests__/route-integration.test.ts`) runs the
   real routes through the agent path with the flag on and asserts identical
   status codes, response shapes, `usageId` presence, and refund-on-failure.
3. **Production.** Flip `USE_GENERATION_AGENT=true` in Production once the canary
   is clean. No deploy needed to revert — unset the env var.

## Follow-ups (out of this slice)

- Routes that want the wall-clock abort to cancel the in-flight provider request
  (not just the function) should forward `ctx.abortSignal` (now contractually
  available, optional) into their provider client / `fetch`. The provider
  clients today carry their own shorter `AbortSignal.timeout(...)`; the agent
  deadline is a longer backstop above those.
- Pairs with the QStash durable-queue ticket for long jobs — durable agents can
  survive function timeouts entirely once that lands.
