---
"web": patch
---

Refuse unprovisionable generation before any token is spent (#9117). `music` is declared unavailable in code (`UNAVAILABLE_CAPABILITIES`, pending the ElevenLabs move in #9522) and refused at every entry point: `/api/capabilities` reports it `unprovisionable` with a user-facing hint and the tracking issue, the six generation dialogs, the Asset panel menu and the Audio inspector show an explicit unavailable state, the `generate_music` chat tool and `forge.ai.generateMusic` answer with the reason instead of calling the route, and `/api/generate/music` returns 503 `SERVICE_UNAVAILABLE` immediately after authentication. `/api/capabilities` now also honours a signed-in user's own (BYOK) keys and is always served `private`. Adds `web/scripts/verify-platform-generation.ts`, which probes each configured provider's documented credit-free endpoint and prints a pass/fail table, and the `docs/guides/platform-keys.md` runbook.
