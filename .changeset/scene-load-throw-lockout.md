---
"web": patch
---

Fixed a data-loss bug where an engine failure during a scene load left saving enabled. When the engine threw while opening a scene — switching scenes in the Scene Browser, the AI assistant's `switch_scene`, `load_scene` or `new_scene` tools, importing a scene file, clearing the scene for a generated one, or applying a template — the editor treated the failure as an ordinary refusal of the incoming scene and kept saving on. But such a failure can arrive after the engine has already started replacing the scene, so the next autosave, Ctrl+S or cloud save could write a half-applied viewport over the stored scene. The editor now locks every save path with the "engine failed while loading it" notice in that case, exactly as it already did when the failure reached it another way, and the Scene Browser, the toolbar and the assistant's tools tell you to reload rather than claiming the current scene is unchanged.

A plain refusal from the engine behaves as before: switching to or importing a scene the engine rejects still leaves the current scene on screen with saving enabled, and the Reload button on the lockout notice remains the way back after an engine failure.
