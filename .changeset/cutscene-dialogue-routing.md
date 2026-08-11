---
"web": patch
---

Fix cutscene dialogue beats doing nothing. A dialogue keyframe builds a
`start_dialogue` command, but that command lives entirely in the browser — the
engine has never known it. The player was handed the engine dispatcher, which
rejected the command — a console error for a developer, nothing at all for the
viewer: every authored dialogue beat in every cutscene played through with no
dialogue and no user-visible error. Cutscene playback now routes browser-side
commands to their real handler, and a cutscene pointing at a deleted dialogue
tree says so instead of playing a silent gap.
