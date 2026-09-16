---
"web": minor
---

Add a multi-layer data model and layer panel to the Pixel Art Editor. Sprites are now composed of ordered layers, each with its own pixel grid, visibility toggle, opacity and name. The new layer panel lets you add, delete, reorder, rename, hide/show and select layers, and the canvas render, undo/redo and PNG export all composite the visible layers in order. Drawing tools write only to the active layer. This is the manual-controls layer-model slice; AI parity and the remaining pixel-editing operations continue under the parent tracking issue.
