---
"web": patch
---

fix(api): isolate in-flight dedup failures per joiner in the AI generation response cache

`cachedGenerate()` shares a single in-flight promise across concurrent callers
with the same cache key. Previously, when that shared promise rejected (a
transient provider error, or — for a same-user request — an `ApiKeyError`),
**every** waiting joiner inherited the same rejection and was permanently bound
to one attempt's failure, even though each could have succeeded independently.

The joiner path now isolates failures: on rejection it re-checks the cache (so a
surviving joiner rides a concurrently-populated result instead of redundantly
regenerating and re-charging) and otherwise falls through to run its own
independent attempt. Because the failed originator already releases any tokens it
deducted, a joiner only pays when its own attempt succeeds. The userId-in-key
invariant that keeps dedup same-user-only is now documented next to the in-flight
logic and locked by a guard test.
