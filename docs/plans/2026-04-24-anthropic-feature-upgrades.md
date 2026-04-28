# Anthropic/Claude Feature Upgrades — Plan

**Date:** 2026-04-24
**Tickets:** PF-741 (#8496), PF-740 (#8497), PF-739 (#8498)
**Owner:** Engineering

## Goal

Close three gaps identified in the 2026-04-24 Anthropic feature audit:
1. **PF-741** Add Opus 4.7 as a deep-generation quality tier above Sonnet.
2. **PF-740** Expose the MCP server over Streamable HTTP (currently stdio-only).
3. **PF-739** Enable 1h extended cache TTL on long-lived prefix content.

All three are independent; they can run in parallel but share a dependency on the centralized model-constants refactor in `web/src/lib/ai/models.ts`.

## Sequencing

```
 Week 1           Week 2           Week 3
 ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
 │ PF-741      │  │ PF-741      │  │ PF-741      │
 │ Opus tier   │→ │ A/B flag on │→ │ Decision    │
 │ + harness   │  │ 10% traffic │  │ memo + GA   │
 └─────────────┘  └─────────────┘  └─────────────┘
 ┌─────────────┐  ┌─────────────┐
 │ PF-739      │  │ PF-739      │
 │ 1h TTL impl │→ │ Metrics +   │
 │ + tests     │  │ cost memo   │
 └─────────────┘  └─────────────┘
 ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
 │ PF-740      │  │ PF-740      │  │ PF-740      │
 │ HTTP trans- │→ │ Auth + rate │→ │ Deploy to   │
 │ port + test │  │ limit       │  │ mcp.sf.ai   │
 └─────────────┘  └─────────────┘  └─────────────┘
```

## PF-741 — Opus 4.7 deep-generation tier

### Why first
Cheapest to implement, highest-quality lever for our generation-heavy flows (GDD, world builder, cutscenes). Unblocks decisions about where else Opus makes sense.

### Implementation
**Files to touch:**
- `web/src/lib/ai/models.ts` — add `AI_MODEL_DEEP`, `GATEWAY_MODEL_DEEP`, `AI_MODELS.deep`
- `web/src/lib/ai/gddGenerator.ts` — route deep path
- `web/src/lib/ai/worldBuilder.ts` — route deep path
- `web/src/lib/ai/cutsceneGenerator.ts` — route deep path
- `web/src/lib/flags/` — new flag `USE_DEEP_GENERATION` (default `false`)
- `web/src/lib/ai/__tests__/models.test.ts` — cover `AI_MODELS.deep`
- `docs/decisions/2026-05-01-opus-deep-tier.md` — decision memo template

**Phases:**
1. **Constants + flag scaffold** (1 day) — add tier, thread through three generators, no behavior change when flag off
2. **A/B harness** (1 day) — PostHog event `ai_deep_generation_eval` with `{ model, tokens_in, tokens_out, latency_ms, user_id, surface }`
3. **10% canary** (3 days) — flip flag for 10% of paid users; monitor cost + retention
4. **Decision memo** (1 day) — merge memo with recommendation (default on for paid tiers / keep off / scope narrower)

### Risk & mitigation
- **Cost spike:** Opus is ~5x Sonnet. Canary at 10% caps blast radius.
- **Latency regression:** Opus single-shot is slower. Deep paths are already async/background — no user-facing latency impact expected.

### Acceptance gate
- Canary metrics show cost delta within budget OR retention lift justifies it
- Decision memo merged
- Flag default documented in `CLAUDE.md`

---

## PF-740 — MCP Streamable HTTP transport

### Why second
Unblocks remote MCP hosts (Cursor, browser-based, custom agents). Not urgent (stdio works for editor), but prerequisite for `.dxt` distribution and public MCP surface.

### Implementation
**Files to touch:**
- `mcp-server/src/index.ts` — transport selection by `MCP_TRANSPORT` env (`stdio` default | `http`)
- `mcp-server/src/transport/http.ts` — new: `StreamableHTTPServerTransport` wiring + health + auth middleware
- `mcp-server/src/transport/rateLimit.ts` — new: Upstash wrapper mirroring `web/src/lib/rate-limit/`
- `mcp-server/src/__tests__/transport-http.test.ts` — E2E tool invocation over HTTP
- `mcp-server/README.md` — document both transports + example curl + `.dxt` path
- `infra/mcp-http/` (new) — Vercel wrapper if we ship to `mcp.spawnforge.ai`

**Phases:**
1. **Transport + health endpoint** (2 days) — `/mcp` (Streamable HTTP), `/health`, stdio still default
2. **Auth + rate limit** (1 day) — Bearer token check via `MCP_HTTP_TOKEN`, Upstash rate limit 30/5m per IP
3. **E2E test** (1 day) — spin transport, invoke one tool, assert response
4. **Deployment** (2 days, optional — may become separate ticket) — Vercel function at `mcp.spawnforge.ai`, DNS, env vars, Sentry wiring

### Risk & mitigation
- **Auth surface:** shared-secret Bearer is weakest-acceptable for MVP. OAuth/Clerk integration is a follow-up ticket.
- **Stateful sessions:** Streamable HTTP supports session resumption via `Mcp-Session-Id`. Implement stateless first; add session persistence only if a consumer needs it.

### Acceptance gate
- `MCP_TRANSPORT=stdio` path unchanged (editor keeps working)
- `MCP_TRANSPORT=http` path responds to `GET /health` + tool invocation
- Auth rejects missing/invalid Bearer with 401
- Rate limit returns 429 after threshold

---

## PF-739 — 1h extended cache TTL

### Why third
Pure optimization. Depends on PF-741 landing first only for code proximity (same file cluster). Impact is token-cost reduction, not feature unlock.

### Implementation
**Files to touch:**
- `web/src/lib/ai/cachedContext.ts` — add `CacheTier = 'short' | 'long'` parameter to helpers
- `web/src/lib/providers/resolveChat.ts` — wire `extended-cache-ttl-2025-04-11` beta header when any `long` block present
- `web/src/lib/ai/sceneContext.ts` — tag scene context as `long`
- `mcp-server/manifest/commands.json` consumers in the chat path — tag tool manifest as `long`
- `web/src/lib/ai/__tests__/promptCache.test.ts` — cover both tiers
- `web/src/lib/ai/__tests__/resolveChat.test.ts` — assert beta header attachment
- PostHog dashboard update — `ai_cache_hit_rate` with breakdown by tier

**Phases:**
1. **Tier param + beta header** (1 day) — helpers accept tier, header attaches conditionally
2. **Tag long-lived content** (1 day) — scene context, tool manifest
3. **Tests + instrumentation** (1 day) — cache-read/write token logging
4. **7-day cost memo** (at day 7) — compare pre/post cache-hit rate and net token cost

### Risk & mitigation
- **Storage billing:** 1h TTL has a minimum-storage component. The 7-day memo validates assumption that re-ingest savings > storage cost.
- **Cache invalidation:** Tool manifest changes on every MCP command addition. Key must include a manifest hash so new commands invalidate the long-TTL block. Covered in the cache-key computation (already hashes content).

### Acceptance gate
- `cache_read_input_tokens` / `cache_creation_input_tokens` metrics visible in PostHog
- Unit tests cover 5m vs 1h TTL paths
- 7-day memo shows net token-cost reduction (or is rolled back)

---

## Cross-cutting

### Testing strategy
- **Unit:** extend existing `__tests__/` in `web/src/lib/ai/` for each ticket
- **Integration:** run `npm run test` after each phase; CPU-aware targeted tests during dev
- **Manual:** browser verification via Playwright MCP on the `/chat` surface

### Instrumentation
All three tickets add PostHog events. Centralize under a single dashboard: **"AI Gen — Model + Cache"** with:
- `ai_deep_generation_eval` (PF-741)
- `ai_cache_hit_rate` (PF-739)
- MCP HTTP invocation counts (PF-740, added to existing MCP dashboard)

### Rollout order
1. Ship PF-741 flag-off → canary → decide
2. Ship PF-739 to all traffic (low risk — cache savings are unconditional)
3. Ship PF-740 behind `MCP_TRANSPORT=http` opt-in; promote to public endpoint only after internal dogfooding

### PR discipline
- Three separate PRs, one per ticket
- Each PR has `Closes #NNNN` + milestone
- Each PR has a changeset (user-facing: PF-741 and PF-739; PF-740 is infra-only → `skip changeset` label)
- Lint + tsc + vitest must pass before PR opens (quality gate)
- User reviews and merges — never self-merge

### Out-of-scope (future tickets)
- Files API integration for image/PDF uploads in chat
- `.dxt` packaging (depends on PF-740 being stable)
- MCP Tasks/Sampling/Media primitives (await SDK stable)
- Hardcoded-model-string cleanup flagged in `HARDCODED_AUDIT.md` (separate mechanical refactor)
