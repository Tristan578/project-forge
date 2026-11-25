---
"web": patch
---

Fixed the `scene_create` step leaving a ghost scene behind when it failed. The step registers the new scene in the project's scene list before asking the engine to clear the starter scene, so if the engine threw or refused, the list kept an entry the engine never created, and a later save or scene switch could act on a scene with no content. The step now restores the scene list (in browser storage and in the editor) to what it was before, and then fails exactly as before.
