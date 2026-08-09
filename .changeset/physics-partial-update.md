---
"web": patch
---

Fix `update_physics` silently discarding or corrupting partial physics edits.

Asking the AI to change one physics property (for example "make the ground
bouncier") previously rebuilt all 13 fields of the entity's physics body,
sourcing the unspecified ones from whichever entity happened to be selected —
so a single tweak could flip a static platform to dynamic and drop the player
through the level. The engine now accepts a partial patch and leaves untouched
fields at their live values, and the physics feel presets dispatch the payload
shape the engine actually reads instead of one it discarded.
