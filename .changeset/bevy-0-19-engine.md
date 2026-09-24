---
"web": patch
---

The game engine now runs on Bevy 0.19.1 (wgpu 29). Its physics (bevy_rapier 0.35), particle (bevy_hanabi 0.19), orbit-camera (bevy_panorbit_camera 0.35) and transform-gizmo dependencies moved with it in the same change. The `.forge` scene file format is unchanged, and saved keyframe animation clips load back intact.
