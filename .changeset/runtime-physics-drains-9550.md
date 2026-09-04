---
"web": patch
---

Exported (runtime) games now apply `set_gravity2d`, the 2D/3D joint commands, the debug-physics toggles and the joint/physics2d reads. Before, the runtime engine build accepted and queued them but had no system to drain the queue, so `forge.physics2d.setGravity` silently did nothing and grew memory by one entry per call for the life of the game (#9550). Ships to games exported after the next engine build.
