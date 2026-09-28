---
"web": patch
---

Camera follow smoothing now reaches every mode that follows a target, and the GDD's `smoothing` is converted to the engine's unit instead of being dropped.

- **GDD conversion.** The GDD's authored camera `smoothing` (the fraction of the gap to close each frame, 0..1) is converted into the engine's `followSmoothing`/`damping` (a rate per second) instead of being silently reported as an unmapped key: `smoothing: 0.1` now reaches the engine as `damping: 6`. A `smoothing` above 1 is refused and reported as "must be between 0 and 1". `tilt`, `perspective`, `locked` and `canOrbit` are documented as having no engine parameter under any spelling; `followX`, `followY`, `offset`, `leadAhead`, `zoomMin` and `zoomMax` remain unmapped and reported, pending their own unit checks.
- **Side Scroller and Top Down now honour Smoothing.** `set_game_camera` sends `damping` for those modes (it was previously dropped and the engine used its default of 5 whatever was authored), the inspector shows the Smoothing row for them, and the cutscene generator is told `followSmoothing` applies to every following mode.
- **Smart-camera 2D presets carry their follow rate.** `platformer_2d` now applies its `followSmoothing` of 4 and `top_down_strategy` its 2, where both previously ran at the engine default of 5 — re-applying either preset changes the camera feel slightly.
- **Docs and tooltips.** The Game Cameras guide now states that Smoothing is a rate per second where higher is snappier (it said the opposite), drops three parameters the editor never had, and every Game Camera control in the inspector has a tooltip. The Target ID field, its tooltip and the guide no longer claim that a blank target follows the selected entity — nothing ever did that; every mode except Fixed needs a Target ID and does not move without one.
