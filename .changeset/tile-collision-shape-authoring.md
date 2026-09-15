---
"web": minor
---

Add per-tile collision silhouette metadata authoring: none, full, half-top, half-bottom, slope-left, and slope-right. Use the Tilemap inspector, the in-app AI command `set_tile_collision_shape`, or `forge.tilemap.setCollisionShape` during editor test-play. Edits appear after engine confirmation, persist in scene exports, and support undo; unchanged shapes preserve redo history. Older scenes retain their layer collision flag and load with no per-cell shapes authored.

These shapes do not affect play physics yet; runtime collider generation remains tracked in #9814. The new script methods are unavailable in standalone HTML/ZIP scripts.
