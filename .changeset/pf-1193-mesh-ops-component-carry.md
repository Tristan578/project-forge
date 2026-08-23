---
"web": patch
---

Array and Combine now keep everything attached to your objects.

Repeating an object with Array kept its look, lights, physics body, sound and
particles, but silently threw away its gameplay components (health, damage,
pickups), animation clips, terrain, joints, camera settings, level-of-detail
settings and everything 2D — sprites, 2D physics, tilemaps and 2D skeletons. A
repeated enemy stopped being an enemy.

Combine was worse: the merged object inherited nothing at all from the objects
that went into it, coming out as a plain grey shape with no material, no
physics and no behaviour. Undoing a Combine also brought the originals back
stripped of their physics, lights and source files.

Nothing reported either loss — the objects simply came out inert.

Both now carry the full component set. Sounds that were muted stay muted rather
than switching themselves on, and a merged object keeps the gameplay behaviour
of the first object that contributed geometry while dropping the parts that
only describe a single shape.
