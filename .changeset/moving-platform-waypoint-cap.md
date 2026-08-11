---
"web": patch
---

Bound `movingPlatform.waypoints` on both sides of the engine bridge. The list had
a lower bound (two points) and no upper one, and the values are LLM-authored — a
generated GDD asking for a long patrol route grew an unbounded `Vec` that
`system_moving_platform` walks every frame and that gets serialized into every
scene save. Both sides now cap at a single `MAX_WAYPOINTS` constant, parsed out
of the Rust by the TypeScript test so the two cannot drift apart silently. Points
the engine would discard are also discarded in the store, including doubles that
survive `Number.isFinite` in JavaScript but overflow to infinity as an `f32`.
