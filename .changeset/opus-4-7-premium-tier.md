---
"spawnforge": minor
---

Add Opus 4.7 as the premium chat model, gated behind the Pro tier. New constants `AI_MODEL_PREMIUM`, `GATEWAY_MODEL_PREMIUM`, and `AI_MODELS.premium` / `AI_MODELS.gatewayPremium` expose the model id and its gateway-format equivalent. A new `isPremiumModel(model)` helper recognises both bare and gateway-format ids without substring matching, so future Opus revisions must be opted in explicitly.

The chat route rejects premium model requests from non-Pro tiers with a 403 *before* token deduction, so a misconfigured client cannot accidentally burn the user's balance. The chat-input model picker shows the option to all users but disables it for non-Pro accounts so they get a clear UX signal instead of a silent server error.
