---
"web": patch
---

Opening a saved project in a fresh browser tab now loads its scene. The editor page hands the stored scene to the store before the engine has attached, and that load was deferred and then forgotten, so the tab showed the engine's starter scene and the next autosave could write it over the project. The deferred load is now held and replayed once, through the same path as any other load, the moment the engine attaches; a rejection then locks saving the same way a live rejection does.
