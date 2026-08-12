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

Also fixed three validators that were passing arrays they exist to reject.
`Array.prototype.every` skips array holes, so `[1, , 3]` cleared every one of
them without the missing slot being checked. On the engine wire that shipped the
gap as a `null` the engine drops and the store keeps. In dialogue an `and` group
with a missing condition reported itself satisfied; separately, a `null`
condition, node or choice in an imported or persisted tree crashed playback, so
both `JSON.parse` boundaries now drop members the declared types say cannot
exist. In the effect system an incomplete binding was accepted by a type guard
whose narrowing promises the opposite, leaving `applyBinding` — which iterates
with `for...of`, and so does not skip the gap — to throw on it at gameplay time.
