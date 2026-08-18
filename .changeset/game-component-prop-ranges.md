---
"web": patch
---

Game components: numeric properties are now clamped to the same ranges the engine applies, so an out-of-range value from the AI, the MCP tools or the inspector reads back as the number the running game actually uses instead of the one that was requested.
