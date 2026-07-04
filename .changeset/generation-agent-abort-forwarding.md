---
"web": patch
---

fix(generate): sprite-sheet and tileset-gen generation responses now include usageId so failed jobs refund from the client

All 12 generate routes now forward the generation agent's abort signal into their
provider HTTP calls, so a per-route wall-clock deadline cancels the in-flight
request deterministically rather than only the factory's await. Provider-error
details are no longer exposed in voice/batch user-visible error messages.
