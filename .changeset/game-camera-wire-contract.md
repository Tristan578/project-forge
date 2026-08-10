---
"web": patch
---

Fix `set_game_camera`, which never reached the engine from any call site. The
engine deserialized the camera mode as an externally-tagged enum while every
caller sent a camelCase string with flat parameters, so the command was dropped
before it was queued — silently, because engine dispatch returns no result. The
Game Camera Inspector, the AI `set_game_camera` tool, smart-camera presets and
cutscene camera tracks were all affected.

Also removes three camera parameters (`followLookAhead`, `sideScrollerHeight`,
`topDownAngle`) that no engine camera mode has ever had a field for.
