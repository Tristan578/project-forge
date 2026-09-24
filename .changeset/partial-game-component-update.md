---
"web": patch
---

`update_game_component` (in-app AI and MCP) is now the partial update its description promised: only the named properties change and every other property keeps its current value. It used to rebuild the component from the named properties alone, so asking to make a moving platform faster also reset its route, loop mode and pause to the defaults. Updating a component the entity does not have now reports that instead of reporting success, and the `componentType` enum in the command manifest gains `dialogue_trigger`, which the engine and the handler already accepted.
