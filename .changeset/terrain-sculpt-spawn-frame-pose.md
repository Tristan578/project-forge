---
"web": patch
---

Sculpt a terrain with its real pose the frame it spawns. `apply_terrain_spawn_requests` relied on the required `GlobalTransform`, whose default is the identity until `PostUpdate` propagates — but the terrain drains are `.chain()`ed, so `apply_terrain_sculpts` sees the new terrain in the same frame and converted the world-space brush through the wrong affine, landing a hill on the terrain's local coordinate instead of the requested world one.
