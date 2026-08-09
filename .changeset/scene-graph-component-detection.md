---
"web": patch
---

The scene graph now reports which components each entity carries. `detect_components` was a stub returning an empty list, so every node the engine emitted claimed to have no components at all — and ten editor surfaces classify entities by exactly that list. Light counts read zero, the chat entity picker could not tell a mesh from a light, and the LOD, pacing, camera, physics-feel and design-teacher panels all silently took their fallback branch.

Scene Statistics additionally counted component names the engine never emits, so its physics, audio, particle and game-component rows would have stayed empty even once the engine reported correctly. Those counters now key on the emitted names and count entities rather than component names, so an entity carrying both a data component and its enabled-marker counts once. The "Animation Clips" row is removed — the editor has no scene-wide source for it, and a row that can only ever read zero is worse than no row.

The engine half ships with the next WASM build.
