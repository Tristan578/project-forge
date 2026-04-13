---
"spawnforge": patch
---

Replace pipeline+ZREM with atomic Lua EVAL in distributed rate limiter to eliminate phantom entries on deny cleanup failures
