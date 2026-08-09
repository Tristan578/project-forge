---
"web": patch
---

Expose the health component's `despawnOnDeath` knob across the editor, AI chat, and MCP surfaces. The engine has always honored the field (defaulting to `true`), but nothing above the bridge could author it, so a boss or destructible prop that should leave a wreck at zero health had no way to say so.
