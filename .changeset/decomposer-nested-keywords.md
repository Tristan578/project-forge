---
"web": patch
---

Fix the GDD panel classifying almost every prompt as a platformer. The local
system decomposer counted a keyword once per table entry it appeared in, and
the table nests keywords throughout (`jump` inside `jumping`, `platform`
inside `platformer`, `race` inside `racing`), so a single word could outscore
two independent signals and promote its category to "core" on its own. Each
textual signal now counts once, and entries tie-break on the most specific
keyword matched rather than on their position in the table — so "a top-down
game where you jump" is top-down movement with a top-down camera.
