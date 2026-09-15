---
"web": minor
---

UI builder widgets now support responsive layout anchors and constraints. Each widget can pin to any of nine edge/corner anchors and carry pixel offsets plus minimum/maximum width and height bounds, so a screen built once adapts from a 360px phone to a desktop without clipping its core actions (for example, a call-to-action keeps a 44px tappable size on narrow screens). Anchors and constraints resolve identically in the editor preview and in played/exported games, are editable from the widget property panel, and are settable through the in-app AI with the same validated data contract (an invalid min/max pair is rejected with an actionable error). Scenes authored before this change keep their existing absolute positioning unchanged.
