---
"spawnforge": patch
---

ci(cd): add pre-flight production domain attachment check

Asserts that `spawnforge.ai` and `www.spawnforge.ai` are attached to the
target Vercel project (in the configured team scope) before the production
deploy step runs. Fails loud at deploy time with an actionable error message
instead of letting the deploy succeed silently while traffic continues to
serve a stale build (the failure mode in #8518).
