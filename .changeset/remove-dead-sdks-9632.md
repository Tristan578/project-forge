---
"web": patch
---

Removed two dependencies nothing imported: `@anthropic-ai/sdk` (every Claude call goes through the AI SDK providers) together with the Sentry `anthropicAIIntegration` that could never emit a span, and `@google/generative-ai` with the unused semantic docs search it powered (live docs search is lexical). No production behaviour changes; the npm audit and changelog surface shrinks.
