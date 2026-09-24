---
"web": patch
---

Exported games built against the runtime engine now show their scene. The runtime build accepted the exporter's `load_scene` command but never applied it (the drain was editor-only, waived on the claim that an exported game boots from embedded scene data, a path that does not exist), so such an export rendered the engine's default scene. The scene-load system is now compiled and registered in every build, and the runtime drain audit pins it so the waiver cannot return.
