---
"spawnforge": minor
---

Enable Anthropic 1h extended prompt cache TTL on the chat route. The base system prompt and engine scene context are now tagged for the 1-hour ephemeral cache (via `extended-cache-ttl-2025-04-11`), so chat sessions that idle for more than 5 minutes no longer re-ingest the full prefix. Doc context and per-turn content stay on the default 5-minute TTL. Adds `ai_cache_hit_rate` Vercel Analytics event for measuring impact. Direct Anthropic backend only — gateway path is unchanged.
