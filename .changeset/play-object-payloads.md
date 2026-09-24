---
"web": patch
---

Published games on `/play` and exported games now hand the engine object payloads it can read. `/play` sent `load_scene` as a JSON string straight after `init_engine`, which the engine refused twice over (no `json` field, and the command queue does not exist until the first frame), so every published game played the engine's default scene with nothing reporting it; it now sends `{ json }` once the engine accepts commands, within a bounded wait, and a refused scene is shown as an error instead of a silent default scene. Exported games flushed every script command (`forge.physics.applyForce`, `forge.audio.play`, ...) as a JSON string; they now send the command object and warn once per command the engine refuses.
