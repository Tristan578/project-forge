---
"web": patch
---

Correlate scene-export requests so a listener only consumes the export it asked for. `export_scene` now carries an optional request id that the engine echoes back on `SCENE_EXPORTED`, preventing an autosave tick or cloud save from being mistaken for a pending game export or file download.
