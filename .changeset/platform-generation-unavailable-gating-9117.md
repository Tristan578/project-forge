---
"web": patch
---

Refuse unprovisionable generation before any token is spent (#9117). `music` is declared unavailable in code (`UNAVAILABLE_CAPABILITIES`, pending the ElevenLabs move in #9522): `/api/capabilities` reports it `unprovisionable` with the tracking issue, every generation dialog shows an explicit unavailable notice and disables Generate, and `/api/generate/music` returns 503 `SERVICE_UNAVAILABLE` before the key resolves. `/api/capabilities` now also honours a signed-in user's own (BYOK) keys, served as a private response. Adds `web/scripts/verify-platform-generation.ts`, which probes each configured provider's documented credit-free endpoint and prints a pass/fail table, and the `docs/guides/platform-keys.md` runbook.
