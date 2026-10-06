---
"web": patch
---

Fixed a bug where a 2D game lost its 2D mode the moment it left the editing session. The engine's 2D camera, the only one sprites are visible through, was switched on only by the live `set_project_type` command, and nothing persisted that choice: a published 2D game loaded on its `/play` page in the default 3D mode and showed an empty canvas, a 2D project reopened after a reload came back in 3D with the tilemap tools and 2D inspector sections hidden until an AI turn happened to set the type again, and the 2D templates loaded in 3D mode with their sprites invisible.

The scene file now carries the project type as `metadata.projectType` (`"2d"` or `"3d"`). The engine writes it on every save from its own state and restores it on every load, so it travels with the scene through the `.forge` download, auto-save, cloud save, scene switching, checkpoints, the publication snapshot, remixes, forks and the HTML/ZIP exports. The engine reports the restored type to the editor, which mirrors it into the store, so a reopened 2D project is 2D before anything else happens. The `/play` page also sends the type explicitly after the scene is accepted and before play starts, and treats a refusal as a failed start (an error message) rather than playing a 2D scene through the 3D camera. A 2D template now opens in 2D mode.

A scene saved before this change has no key and opens as 3D, exactly as before; it gains the key on its next save. No scene format version change. Separately, `set_project_type` now refuses a value other than `"2d"` or `"3d"` with a clear error; it used to answer success and silently do nothing.
