---
"spawnforge-web": patch
---

Match GDD system keywords at word boundaries instead of anywhere in the prompt.

The local system decomposer tested each keyword with `text.includes()`, so a
keyword matched inside unrelated words: `car` in "scary", `star` in "start",
`click` in "clicker", `run` in "runner". A horror prompt was given vehicle
movement, "where you start the level" was read as collecting pickups, and the two
entries that describe idle-clicker and endless-runner games lost to entries whose
vocabulary the prompt never used.

Keywords now match as whole words, with an optional plural so the table can keep
listing `coin` while prompts say "coins". Evidence is counted as distinct regions
of the prompt rather than as keywords, so the table's own nesting (`platform`
inside `platformer`, `runner` inside `endless runner`) no longer lets one word
score twice and beat a rival entry — which is what classified "a top-down game
with jumping" as a platformer. Two separate mentions still count twice.

`priority` now records whether the prompt named the category at all, rather than
whether it tripped two keywords; that count was largely measuring the nesting
above. The systems panel also names each detected system by what was detected
rather than by its category, so a prompt asking for pixel art no longer reads
back "visual".
