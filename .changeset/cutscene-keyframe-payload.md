---
"web": patch
---

Cutscenes: keyframe payloads are now read against the track type's own vocabulary instead of being copied through whole, so a generated cutscene no longer carries invented fields into the engine. An animation keyframe with no clip and a dialogue keyframe with no tree now decline to dispatch rather than firing a command that addresses nothing.
