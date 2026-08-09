---
"web": patch
---

Stop game-component integer fields from silently reverting to their defaults when JSON spells them as floats.

`build_game_component` read `collectible.value`, `spawner.maxCount` and `win_condition.targetScore` with `as_u64()`, which answers `None` for a float-formatted integer like `10.0`. JSON has one number type and the producers on this wire spell integers differently — JS `JSON.stringify(10)` emits `10`, but anything routed through a float (an inspector slider, an LLM writing `10.0`, a `.forge` scene round-tripped through `f64`) emits `10.0`. The field then fell back to its default, so a collectible authored as worth 50 points was worth 1 — the exact unusable-value outcome the permissive builder exists to prevent, and inconsistent with the sibling float and vector readers, which both take either spelling.

These fields now parse via `as_f64()`, round to the nearest whole (a fractional count means nothing to a system that iterates it), and clamp into range instead of dropping — the same clamp-don't-drop rule the float reader already followed. Non-numbers still leave the default standing.
