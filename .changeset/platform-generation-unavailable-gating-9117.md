---
"web": patch
---

Refuse generation that cannot succeed, before any token is spent (#9117).

`/api/capabilities` now answers per-user rather than per-deployment: it honours a signed-in user's own (BYOK) keys, is always served `private`, and marks capabilities no key can ever enable (`UNAVAILABLE_CAPABILITIES` — currently `music`, pending the ElevenLabs move in #9522) as `unprovisionable` with a user-facing reason and the tracking issue.

The editor acts on that in two different ways, because they are two different situations:

- **Nothing can enable it** (`music`): the Asset panel menu item and the Audio inspector button are disabled at the entry point with an "Unavailable" badge and the reason in their accessible name; the `generate_music` chat tool and `forge.ai.generateMusic` answer with the reason instead of calling the route; and `/api/generate/music` returns 503 `SERVICE_UNAVAILABLE` immediately after authentication.
- **A key is missing** (any capability with no platform key and no BYOK key of yours): the entry point stays clickable. Opening it shows a notice naming the provider you need and linking to Settings, with the prompt inputs and Generate disabled — so the instruction for fixing it is somewhere you can actually reach.

If the route cannot read your saved keys (auth, user lookup, or the BYOK query fails) it answers `degraded: true` and the editor blocks nothing on it, so a database blip can never disable generation for someone who holds their own key.

Also adds `web/scripts/verify-platform-generation.ts`, which probes each configured provider's documented credit-free endpoint and prints a pass/fail table, and the `docs/guides/platform-keys.md` runbook.
