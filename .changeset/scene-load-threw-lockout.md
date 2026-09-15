---
"web": patch
---

Lock saving when an engine dispatch throws mid-load during a scene switch. A thrown `load_scene` was previously folded into a clean rejection, so `sceneLoadError` stayed null and the next autosave, Ctrl+S, or cloud save could overwrite the stored scene with the wrecked engine viewport. A thrown dispatch now sets the `ENGINE_LOAD_THREW` lockout regardless of the caller's rejection policy, and both the Scene Browser and the AI `switch_scene` handler tell the user to reload the editor rather than claiming the scene is unchanged. Prefab-state rollback now guards each storage write independently so a failed instances write still restores the prefab library, and checkpoint recovery no longer re-enables saving over a scene recovered from a throw-induced lockout.
