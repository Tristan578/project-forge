---
"web": patch
---

Run the compound chat tools' input validation instead of shadowing it. `compoundHandlers.ts` declared its own private copies of every `helpers.ts` export, so the validated builders never executed in production and a model-supplied material, light, physics body or game component reached the engine through a bare cast. The copies are deleted; the builders now clamp every game-component field to the engine's own range (mirrored from `build_game_component` and pinned against the Rust by test), clamp the material, light and physics fields to what each can mean, round the integer-typed fields, and fall back per field rather than throwing. A win condition described as `collect_all` no longer silently becomes a score game, and a vector component past the f32 range no longer reaches the engine as infinity.
