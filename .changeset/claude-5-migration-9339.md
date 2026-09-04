---
"web": minor
---

Migrate product AI calls to the Claude 5 family.

`AI_MODEL_PRIMARY` moves to `claude-sonnet-5` and `AI_MODEL_PREMIUM` / `AI_MODEL_DEEP` to `claude-opus-5`; the 4.x ids stay exported as `AI_MODEL_PRIMARY_4X` / `AI_MODEL_PREMIUM_4X` and stay in every backend `MODEL_MAP`, so a rollback is a one-line edit. The Vercel AI Gateway ids (`GATEWAY_MODEL_CHAT`, `GATEWAY_MODEL_PREMIUM`) are now derived from those same constants instead of being hand-written, so that rollback also takes effect on the gateway route. `isPremiumModel()` now also recognizes the 4.x Opus id as premium-tier, so a rollback (or a stale in-flight request) can't slip past the Pro-tier gate. The extended-thinking and `effort` provider-options shapes — chosen per model since #9626/#9650, not by this PR — are now built through a single `anthropicThinkingOption()` helper that both `spawnforgeAgent.ts` and `aiSdkAdapter.ts` call, instead of each switching on `thinkingModeFor()` itself.

The game-creation decomposer also stops asking the model for prose and parsing JSON out of it, using `Output.object` structured output against the existing Zod schema.
