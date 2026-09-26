---
"web": patch
---

The game engine now runs on Bevy 0.19.1 (wgpu 29). Its physics (bevy_rapier 0.35), particle (bevy_hanabi 0.19), orbit-camera (bevy_panorbit_camera 0.35) and transform-gizmo dependencies moved with it in the same change. The `.forge` scene file format is unchanged, and saved keyframe animation clips load back intact.

A graphics error no longer shuts the engine down without a word. A one-off error is skipped and the viewport keeps drawing, with a notice you can dismiss. If the error keeps happening, the graphics card runs out of memory, or the browser loses the graphics device, the viewport stops drawing but your scene stays loaded. A notice then explains what happened in plain language and asks you to save from the toolbar before reloading. It offers **Reload editor** and, on WebGPU, **Switch to WebGL2 and reload**. The driver's own message sits under "Technical details" and is sent to error monitoring.

The engine downloads are 15-20% larger on Bevy 0.19, and the CI size budgets were raised to match (see `docs/operations/wasm-size-budgets.md`).
