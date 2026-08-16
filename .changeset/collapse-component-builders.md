---
"web": patch
---

Route AI compound scene tools through the validating game-component builder. Values supplied by the model are now clamped and range-checked before reaching the engine instead of being cast straight through, and compound scenes can attach a `dialogue_trigger` component, which previously failed silently.
