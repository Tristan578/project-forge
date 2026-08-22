---
"web": patch
---

The player now stands on the ground. Character movement was raw translation
added straight onto the transform, so a 3D character had no gravity, no ground
contact and no collision response: it walked through walls and floors, and a
jump was a tween that could be held indefinitely. It is now driven through a
kinematic character controller with gravity, terminal velocity, ground
snapping, a 45-degree slope limit and 0.3-unit step handling, and it collides
with the static geometry the scene already has.

Jumping requires ground. A jump is only spent when the character is actually
standing on something, so the double jump a game grants is the double jump the
player gets — not an unlimited one.

A jump that meets a ceiling now falls. Rapier stops the character but does not
touch its upward speed, so the character used to keep asking to rise and slid
along the underside of the platform for the whole ascent — around 48 frames at
the default jump height.

A character the pipeline forgot to enable physics on no longer fails silently.
It still uses the old movement path, because a kinematic controller needs a
collider, but the engine now warns and names it instead of leaving a player who
walks through walls in a scene that looks correct.

Scripts can tell a jump from a fall. `forge.physics.isGrounded(entityId)`
reports the ground contact the engine computed during the character sweep,
synchronously, so a script no longer has to guess at the top of an arc. It
answers `false` for an entity with no character controller.

Shipping the engine half of this requires a WASM rebuild.
