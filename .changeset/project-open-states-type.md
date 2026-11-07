---
"web": patch
---

Opening a project no longer inherits the previous project's 2D or 3D mode. The editor keeps one engine running across client-side navigation, and a project scene saved without a project type left that engine's mode unchanged. So a project saved before the type was recorded, opened after a 2D project in the same tab, came up in 2D and its next save stored it as 2D (#10374). A project scene that states no type now opens in 3D, the mode a fresh editor starts in, as it already did on a cold open. Projects that state a type, and switching scenes inside a project, behave as before.

New projects created from the dashboard now start from the engine's own empty scene and state 3D. The scene the dashboard sent before had no `metadata` block, which the engine's scene loader requires.
