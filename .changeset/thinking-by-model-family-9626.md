---
"web": patch
---

Extended thinking and effort are now requested in the shape each Claude model accepts: Opus 4.7+, Sonnet 4.6+ and Claude 5 get the adaptive form, Haiku 4.5 and earlier get the token-budget form, and `effort` is dropped for models that reject it. Previously one shape was sent for every model, so a Pro user with the thinking toggle on and the premium model selected received HTTP 400 from the direct Anthropic backend.
