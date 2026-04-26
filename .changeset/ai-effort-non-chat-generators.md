---
"spawnforge": patch
---

Add `effort: 'low' | 'medium' | 'high'` parameter to `createSpawnforgeAgent` and the `/api/chat` body, mirroring the Anthropic provider's reasoning-effort hint. Non-chat generators (`gameReviewer`, `tutorialGenerator`, `gddGenerator`) now opt in to `effort: 'medium'` instead of passing `thinking: false`, letting the SDK pick a sensible reasoning budget instead of guessing token counts.

The chat route gates `effort` behind the same creator/pro tier check used for `thinking` mode and rejects unknown values with a 400. Both fields are emitted independently into `providerOptions.anthropic` and only on the direct backend; gateway routes ignore them.
