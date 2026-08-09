---
"web": patch
---

Game components now accept partial property bags. `build_game_component` merges each recognised field onto the type's default instead of deserializing the whole bag strictly, so a command that names only `speed` no longer fails with "missing field `jumpHeight`". Unusable values (wrong type, non-finite, out of range) fall back to their default rather than rejecting the component, and numeric fields are clamped to the range the engine can simulate. Only an unknown component type or a body that is not a JSON object is still an error.
