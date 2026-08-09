---
"web": patch
---

Bind orchestrator-generated scripts to the engine's entity id instead of the designed entity name. The plan now mints an id per entity, forwards it to the engine via `spawn_entity`'s id override, and `custom_script_generate` binds `set_script` to that id — previously every generated script bound to a name the engine never matches, and the miss was silent.
