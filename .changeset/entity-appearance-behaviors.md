---
"web": patch
---

Generated 3D games now spawn the shape the design asked for. `entity_setup` reads the GDD's `appearance` field when it names a primitive (`primitive:sphere`), instead of always spawning the role-default mesh — previously every enemy, NPC, decoration, trigger and interactable was a cube regardless of what the design specified. Free-text appearance still falls back to the role default rather than failing the step, and 2D entities remain textured planes.

The `behaviors` field is removed from the game design document. Nothing in the pipeline ever read it, so the model was spending tokens writing prose that was parsed, sanitized, stored and then discarded.
