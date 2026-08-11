---
"web": patch
---

Generated 2D games now ship a player that can move. The character rig step gave
2D players a skeleton and nothing else — a skeleton is an animation rig, not a
movement component — so the player stood still no matter what the input did.

The same movement component the 3D path uses is now added for 2D, tuned by the
same feel directive, and the engine steers it along the screen plane instead of
into the depth axis the player cannot see.

Generated games also bind their controls. The engine ships no input bindings by
default, so every generated player previously had a movement component with
nothing wired to drive it; the movement style in the design document now picks
the binding set. And in 3D, moving left works — A and D used to strafe the same
direction.
