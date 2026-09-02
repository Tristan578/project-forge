---
"web": minor
---

Migrate product AI calls to the Claude 5 family and choose the extended-thinking request shape per model.

`AI_MODEL_PRIMARY` moves to `claude-sonnet-5` and `AI_MODEL_PREMIUM` / `AI_MODEL_DEEP` to `claude-opus-5`; the 4.x ids stay exported and stay in every backend `MODEL_MAP` so a rollback is a one-line edit. More importantly, the Anthropic `thinking` and `effort` provider options were gated on the backend rather than the model, which sends one literal to every Claude — and no single literal is valid across the set: Claude 4.7+ rejects `{ type: 'enabled', budgetTokens }` with HTTP 400 while Haiku 4.5 rejects `{ type: 'adaptive' }` and `effort` the same way. Both decisions now come from one table in `web/src/lib/ai/models.ts`, and a model with no known shape omits the field instead of erroring. The game-creation decomposer also stops asking the model for prose and parsing JSON out of it, using `Output.object` structured output against the existing Zod schema.
