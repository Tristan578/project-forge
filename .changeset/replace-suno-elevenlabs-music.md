---
"web": minor
---

Route music generation to ElevenLabs instead of Suno (#9522). Music is generated again — it now uses ElevenLabs `/v1/music`, the same provider (and the same `PLATFORM_ELEVENLABS_KEY`) that already powers sound-effect and voice generation, so one key covers all three audio capabilities. The Suno client is removed, `PLATFORM_SUNO_KEY` is gone, and `studio-api.suno.ai` is dropped from the Content-Security-Policy. `/api/generate/music` now resolves the track synchronously and returns the audio inline (like SFX and voice); the Generate Music dialog and the in-app AI tool attach it immediately. Suno is no longer offered as a bring-your-own-key provider (an existing stored key can still be removed). Historical `suno` database rows are untouched.
