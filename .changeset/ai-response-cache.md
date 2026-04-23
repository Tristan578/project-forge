---
"spawnforge": patch
---

Add AI response caching layer with prompt deduplication. Identical generation requests (SFX, voice, localize) now return cached results instantly without deducting tokens. Uses Upstash Redis in production with in-memory LRU fallback for development.
