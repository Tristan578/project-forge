---
"web": patch
---

Keep the AI chat's prompt cache warm across scene edits on the premium model (#8859).

The engine scene context sat in the leading system prefix, ahead of the conversation history. Anthropic's cache is a prefix cache, so every entity edit changed bytes before the history and re-paid the whole conversation as a cache write on the next turn. On the direct backend with the premium model, the scene context is now appended after the latest user turn as a mid-conversation `role: "system"` message with the same 1-hour cache tier and the same per-user nonce, so the history's cached breakpoints survive a scene edit. The gateway backend and the non-premium models keep the leading embed unchanged.
