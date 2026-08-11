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
`topDownAngle`) that no engine camera mode has ever had a field for, and
rewrites the published MCP `set_game_camera` schema, which advertised those
same authoring names rather than the parameters the engine reads.

Hardens the wire itself: a camera parameter can no longer crash the engine.
Values that saturate to infinity and inverted `[min, max]` ranges are rejected,
and the two sites that clamp between a pair order their bounds first — an
inverted pair reached `f32::clamp`, whose panic takes down the whole WASM
instance and loses the unsaved scene.

Camera parameters the editor's authoring vocabulary has no field for — twelve of
the engine's twenty-one, including field of view and the look-at target — now
survive a round trip through the store. `set_game_camera` replaces the whole
component, so a parameter the next payload omits comes back as the engine's
default: dropping these on read was not leaving them alone, it was resetting
them. An entity named `__proto__` can also no longer reparent the camera record,
which previously made every camera-less entity report the polluting camera as
its own.

Fixes the 3D auto-polish camera, which sent a follow smoothing of 0.8 as though
it were a 0..1 blend factor. The engine reads it as a rate per second, so every
auto-polished 3D game shipped a follow camera roughly six times slower than the
default.
