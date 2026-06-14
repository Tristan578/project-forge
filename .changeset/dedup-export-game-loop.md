---
"web": patch
---

Extract the exported-game per-frame loop into a single shared helper (`generateGameLoopFragment`) consumed by both the single-HTML and ZIP exporters, so the two paths can no longer silently drift (the cause of the #8754 touch-input ordering defect re-appearing in the sibling generator).
