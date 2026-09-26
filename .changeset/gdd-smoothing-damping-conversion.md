---
"web": patch
---

Convert the GDD's authored camera `smoothing` (a 0..1 per-frame lerp fraction) into the engine's `followSmoothing`/`damping` (a rate per second) instead of silently reporting it as an unmapped key. A GDD-authored camera directive with `smoothing: 0.1` now reaches the engine as `damping: 6` rather than being dropped, so a tuned follow feel in a GDD actually reaches the game. `tilt`, `perspective`, `locked` and `canOrbit` are documented as having no engine parameter under any spelling; `followX`, `followY`, `offset`, `leadAhead`, `zoomMin` and `zoomMax` remain unmapped and reported, pending their own unit checks.
