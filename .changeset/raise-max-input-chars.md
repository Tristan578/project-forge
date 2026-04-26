---
"spawnforge": minor
---

Raise the chat conversation size limit from ~150k tokens to ~500k tokens to
leverage Sonnet 4.6's 1M-token context window. Body limit goes from 1MB to 4MB
to fit the new content budget plus image data and tool results. Long
game-design conversations no longer hit a premature 413 wall mid-session.
