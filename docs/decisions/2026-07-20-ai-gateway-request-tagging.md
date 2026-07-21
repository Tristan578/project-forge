# AI Gateway request tagging for cost attribution — routing review

- **Date:** 2026-07-20
- **Status:** Accepted (code half only — see "Dashboard prerequisites" below)
- **Ticket:** PF-969 (#8954)

## Context

`/api/chat` routes to one of two backends depending on tier and BYOK
configuration: direct Anthropic (`isDirectBackend: true`) or the Vercel AI
Gateway (`isDirectBackend: false`, `@ai-sdk/gateway`). Vercel's AI Gateway
dashboard supports per-request budgets, cost reporting, and filtering, but
only for requests that carry identifying metadata — without it, every
gateway-routed request is an anonymous line item, and there is no way to
break spend down by user or by call site.

`@ai-sdk/gateway`'s `GatewayProviderOptions` type (verified against the
installed package at `node_modules/@ai-sdk/gateway/dist/index.d.ts`) exposes
exactly the fields needed for this: `user?: string` ("end-user identifier for
spend tracking and attribution") and `tags?: string[]` ("user-specified tags
for reporting and filtering usage").

## Decision

Wire `providerOptions.gateway.user` and `providerOptions.gateway.tags` on
every gateway-routed `/api/chat` request, sourced from the request's own auth
context — no new data collection, no new field on the wire.

### What changed

- **`web/src/lib/ai/spawnforgeAgent.ts`** — `SpawnforgeAgentOptions` gained
  `userId?: string` and `tags?: string[]`. `createSpawnforgeAgent()` builds a
  `gatewayOptions` object from them and merges it into `providerOptions` under
  the `gateway` key, mirroring the existing `anthropicOptions` pattern used
  for `thinking`/`effort`. The fields are gated on `!isDirectBackend` — direct
  Anthropic calls bypass the Gateway entirely, so `user`/`tags` would have no
  effect there and are omitted rather than sent as dead weight. An empty
  `tags` array is treated the same as unset (no `gateway.tags` key emitted).
- **`web/src/app/api/chat/route.ts`** — the `createSpawnforgeAgent()` call
  site passes `userId: auth.ctx.user.id` and `tags: ['route:chat',
  \`tier:${auth.ctx.user.tier}\`]`. `POST()` runs behind
  `withApiMiddleware(request, { requireAuth: true, ... })`, so
  `auth.ctx.user.id` and `auth.ctx.user.tier` are always populated at this
  call site — no anonymous-caller branch to handle.

### What this is not

Gateway tagging is **observability-only**. It never influences model
selection, routing, or output — `user`/`tags` are reporting fields consumed
by the Gateway dashboard's cost-breakdown views, not by the model resolution
logic in `spawnforgeAgent.ts` (`isDirectBackend` and `model` alone decide
that, unchanged by this PR). This was asserted directly in
`web/src/lib/ai/__tests__/spawnforgeAgent.test.ts`: a case combining direct
Anthropic `thinking` with a set `userId` confirms the direct backend still
emits only `providerOptions.anthropic` and never `providerOptions.gateway`.

Budget *enforcement* (hard spend caps, alerting) is a separate Gateway
dashboard feature this PR does not configure — see below.

## Why tag by route + tier, not by generation type

`/api/chat` is a single multi-turn, tool-calling surface — unlike the
`/api/generate/*` factory routes (which each have a distinct generation
type), there is no finer-grained "kind of request" to tag within chat itself.
`tier:<tier>` gives cost-per-plan visibility (e.g. is the `pro` tier's token
spend proportionate to its price point), which is the dimension most useful
for the billing questions this ticket exists to answer. `route:chat` is
future-proofed for when other gateway-routed surfaces are added and need to
be distinguished in the same dashboard.

## Dashboard prerequisites (not covered by this PR)

This PR ships the code half only — request tagging. It does **not**:

- Configure spend budgets or alerts in the Vercel AI Gateway dashboard.
- Retroactively tag historical requests (tagging applies going forward from
  deploy).
- Change anything for direct-Anthropic-backend requests (BYOK users, or any
  tier routed off the Gateway) — those were never subject to Gateway
  dashboard reporting and remain untagged by design.

Setting up budgets/alerts against the new `user`/`tags` dimensions is a
one-time manual step in the Vercel dashboard and is out of scope here.

## Consequences

### Positive
- Per-user and per-tier cost attribution becomes possible in the Gateway
  dashboard without any new data collection — reuses `auth.ctx.user` already
  present on every authenticated chat request.
- Zero behavioral risk: additive `providerOptions` fields, gated to the
  gateway backend only, with a mutual-exclusivity test confirming the direct
  backend is unaffected.

### Negative / accepted
- Tags are static strings computed inline at the call site
  (`web/src/app/api/chat/route.ts`); if a second gateway-routed surface is
  added later, its call site must set its own `route:` tag by hand — there is
  no shared tag-builder helper yet. Not worth abstracting for a single call
  site.
