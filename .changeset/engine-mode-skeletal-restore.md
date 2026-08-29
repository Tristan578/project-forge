---
"web": patch
---

Playing and stopping a scene no longer erases a 2D skeletal animation. `snapshot_scene` captured the animation but `restore_scene` never put it back, so any rigged 2D entity lost its animation the moment the user pressed Stop.
