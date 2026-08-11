---
"spawnforge-web": patch
---

Fix cutscene dialogue beats doing nothing. A dialogue keyframe builds a
`start_dialogue` command, but that command lives entirely in the browser — the
engine has never known it. The player was handed the engine dispatcher, and
because dispatching returns nothing, the command was dropped in silence: every
authored dialogue beat in every cutscene played through with no dialogue and no
error. Cutscene playback now routes browser-side commands to their real handler,
and a cutscene pointing at a deleted dialogue tree says so instead of playing a
silent gap.
