---
"web": patch
---

Generated games can now collide, which is what makes them winnable.

The creation pipeline built a player, a floor and a set of collectibles and then
never switched physics on for any of them. Rapier only attaches a collider to an
entity that has been enabled, and collision tracking is built purely from those
colliders, so nothing in a generated 3D game ever touched anything else: the
player fell through the ground, collectibles could not be picked up, score never
moved and the win condition was unreachable however the game was played.

Every gameplay entity is now given a body sized to the shape it was spawned as —
a rotation-locked dynamic capsule for the player, sensors for pickups so
collecting one does not knock the player sideways, and solid static bodies for
the ground, platforms and walls. Cameras and lights are deliberately left alone
rather than dropping invisible walls into the level.

Enablement also waits for the engine to finish creating the entities before it
addresses them. Without that pause the commands arrived a frame early, named
entities that did not exist yet, and were discarded without any error being
reported — the step looked successful while enabling nothing. The engine now
also logs a warning when it is asked to enable physics on an entity it cannot
find, so the same class of mistake cannot be silent again.
