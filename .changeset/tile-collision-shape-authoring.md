---
"web": minor
---

Add per-tile collision shape authoring to tilemaps. Each cell can now carry a collision silhouette — none, full, half-top, half-bottom, slope-left or slope-right — authored manually from the Tilemap inspector, through in-app AI via the new `set_tile_collision_shape` command, or from game scripts via `forge.tilemap.setCollisionShape`. The shape data persists in exported scenes, round-trips through play/stop, and is undoable. Older scenes that carry only a layer-level collision flag continue to load unchanged.
