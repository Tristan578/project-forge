---
"web": patch
---

Fix the GDD panel classifying almost every prompt as a platformer. The local
system decomposer picked a category's entry by counting keyword matches, and
the table nests keywords throughout (`jump` inside `jumping`, `platform`
inside `platformer`, `shoot` inside `shooter`), so one word counted several
times and outscored a rival entry that the prompt had named outright — "a
top-down game with jumping" came back as a platformer. Entry selection now
counts each textual signal once and breaks ties on the most specific keyword
matched rather than on position in the table, so "a top-down game where you
jump" is top-down movement with a top-down camera.
