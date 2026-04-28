# ADR: Opus 4.7 Deep-Generation Tier

**Status:** Proposed
**Date:** 2026-04-24
**Tickets:** PF-741 (#8496)
**Deciders:** Engineering
**Review date:** 2026-05-08 (after 7-day canary)

## Context

Primary generation model is Sonnet 4.6 (`AI_MODEL_PRIMARY` in `web/src/lib/ai/models.ts`). It handles:

- **Chat turns** in the editor (latency-sensitive, conversational)
- **Deep generation**: GDD authoring (`gddGenerator.ts`), world building (`worldBuilder.ts`), cutscenes (`cutsceneGenerator.ts`) — single-shot requests where users wait seconds to minutes for a complete document

Deep generations have different constraints than chat:
- **Quality matters more than latency.** A higher-fidelity GDD saves the user from re-prompting.
- **Users are already in a waiting state.** A 30–60s wait for Opus isn't worse than a 20s wait for Sonnet if the output is meaningfully better.
- **Volume is low relative to chat.** Cost multiplier is bounded.

Opus 4.7 (`claude-opus-4-7`) is Anthropic's deepest-reasoning model. It's not the right pick for chat — too slow, too expensive per token — but it's a plausible upgrade for the three surfaces above.

## Options

### A) Sonnet everywhere (status quo)
- **Pros:** Single-model simplicity, predictable cost
- **Cons:** Leaves quality on the table for deep generations; competitors moving to Opus-tier for similar surfaces

### B) Opus everywhere for deep generation (default on)
- **Pros:** Maximum quality uplift
- **Cons:** Unbounded cost exposure; no data on whether users notice the difference

### C) Opus behind a feature flag with canary + decision memo (this ADR)
- **Pros:** Measurable A/B, bounded cost exposure during eval, clean rollback
- **Cons:** Adds a flag to maintain

## Decision

**Ship option C.** Add `AI_MODEL_DEEP = 'claude-opus-4-7'` and route the three deep-generation surfaces through `getDeepGenerationModel()`, which reads `NEXT_PUBLIC_USE_DEEP_GENERATION`. Default off. Emit `ai_deep_generation_eval` to PostHog on every call so both arms of the A/B are observable.

## Rollout

1. **Day 0:** Ship the code with flag default off. Verify `ai_deep_generation_eval` fires with `deepTierEnabled: false` for 100% of deep generations.
2. **Day 1:** Flip flag on for 10% of paid users via environment-based routing (Vercel environment variable split between preview/canary domains — no code change required).
3. **Days 2–7:** Monitor:
   - Token cost delta per generation (Opus vs Sonnet on the same surface)
   - Downstream publish rate (users who generate → publish within 48h)
   - User-reported quality signals from support channels
4. **Day 8:** Write the review-date update to this ADR with one of:
   - **Default on for paid tiers:** if publish rate lifts ≥ 5% and cost fits within AI budget
   - **Keep off:** if lift is < 3% or cost exceeds budget
   - **Narrow scope:** if lift concentrates on one of the three surfaces

## Consequences

### Positive
- Cheap, reversible experiment
- Data-driven decision rather than gut feel
- Surface-level isolation: chat path is untouched

### Negative / accepted
- One new feature flag to maintain for 7+ days
- PostHog event volume grows by ~N/day where N = daily deep-generation count
- If flipped on, cost exposure is real — mitigation is the canary

### Risks
- **Latency regression:** Opus is ~2x slower single-shot. User-facing copy on GDD/world/cutscene should already indicate a progress state; re-verify during canary.
- **Cache invalidation:** Deep-tier generations are unique-per-prompt and not cached across users, so prompt caching savings apply regardless of model. No cache churn expected.

## Follow-ups (separate tickets)

- PF-739 (1h extended cache TTL) — independent optimization
- PF-740 (MCP Streamable HTTP) — unrelated
- Hardcoded-model-string cleanup flagged in `HARDCODED_AUDIT.md` — mechanical refactor, not blocking
