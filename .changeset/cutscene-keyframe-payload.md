---
"web": patch
---

Cutscenes: keyframe payloads are now read against the track type's own vocabulary instead of being copied through whole, so a generated cutscene no longer carries invented fields into the engine. An animation keyframe with no clip and a dialogue keyframe with no tree now decline to dispatch rather than firing a command that addresses nothing. An animation keyframe that names no crossfade now omits the field entirely, letting the engine apply its own 0.3s blend — previously it was sent as `0`, an instant cut nobody asked for.
