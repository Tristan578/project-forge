---
"web": patch
---

Array and Combine now keep everything attached to your objects.

Previously, using Array to repeat an object or Combine to merge several
objects into one silently threw away most of what made those objects work:
physics bodies, sounds, gameplay components (health, damage, pickups),
lights, particle effects, animation clips, 2D sprites, tilemaps and level-of-detail
settings all disappeared. A repeated enemy stopped being an enemy; a combined
prop stopped colliding. Nothing reported the loss - the objects simply came out
inert.

Every component now travels with the copy. Sounds that were muted stay muted
rather than switching themselves on, and a merged object keeps the gameplay
behaviour of the first object that went into it while dropping the parts that
only describe a single shape.
