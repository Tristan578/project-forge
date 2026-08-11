---
"web": patch
---

The side-scroller and top-down cameras are now tunable. Their smoothing, their
follow behaviour, and the side-scroller's vertical clamp had no authoring field
at all, so `set_game_camera` — which replaces the whole component — reset each of
them to an engine default every time any other camera value was edited.

The game camera and 2D physics inspectors also have their help text back.
Eighteen tooltips across the two panels named glossary terms that were never
registered, and an unregistered term renders nothing, so both panels shipped with
no help at all where the little info icons appear.
