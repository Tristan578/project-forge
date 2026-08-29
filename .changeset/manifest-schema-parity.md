---
"web": patch
---

Align 71 MCP manifest entries with the Zod schemas their chat handlers actually validate, so the AI is no longer told about parameters the handler rejects (or left unaware of ones it requires). Covers the sprite, sprite_animation, physics2d, scripting and generation categories, and widens the manifest/schema parity test to catch future drift in both directions.
