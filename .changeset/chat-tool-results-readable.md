---
"web": patch
---

The in-app AI now reads what each editor tool actually returned. Every tool whose result is an object (`get_game_components`, `get_game_camera`, `add_game_component`, most query tools) was handed back to the model as the literal text `[object Object]`, so query tools returned no information and write tools could not report anything beyond "it ran". Results are now serialised as JSON, strings stay verbatim, and any result longer than 8,000 characters is cut there with a note saying how much was omitted.
