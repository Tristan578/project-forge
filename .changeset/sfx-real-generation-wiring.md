---
"web": patch
---

Wire the game-creation asset step to real sound-effect generation. When a plan's
asset step is a sound, the orchestrator now calls the existing authenticated
ElevenLabs SFX path and validates that the returned audio is non-empty and
decodable before the step counts as done — a provider error, zero bytes, or an
undecodable response now degrades to the plan's placeholder instead of reporting
a fabricated success. Asset types without an adapter yet (models, textures,
sprites, music, voice) are explicitly marked pending and resolve to their
placeholder rather than a made-up asset id.
