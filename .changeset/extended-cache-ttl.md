---
"spawnforge": minor
---

Enable the Anthropic 1h extended prompt cache TTL on `POST /api/chat`.

The base system prompt and engine scene context are now tagged for the
1-hour ephemeral cache via the `extended-cache-ttl-2025-04-11` beta. Chat
sessions that idle longer than 5 minutes (canvas editing, preview runs,
long pauses) no longer re-ingest the full ~15k–60k token prefix on the
next turn — they read from cache at ~0.1× input price.

Doc context and per-turn user content stay on the default 5-minute TTL.

Adds an `ai_cache_hit_rate` server analytics event with `cacheReadTokens`
and `cacheWriteTokens` so we can measure impact in PostHog/Vercel
Analytics over the 7 days post-merge.

**Backwards compatible.** The change applies only to the direct Anthropic
backend; the gateway / OpenRouter / GitHub Models paths still receive a
flat string and are unchanged. Existing callers passing `instructions` as
a plain string keep working — the new `InstructionBlock[]` shape is
opt-in.
