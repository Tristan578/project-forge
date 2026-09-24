---
"web": patch
---

Keep the AI chat's prompt cache warm across scene edits on the premium model (#8859).

The engine scene context sat in the leading system prefix, ahead of the conversation history. Anthropic's cache is a prefix cache, so every entity edit changed bytes before the history and re-paid the whole conversation as a cache write on the next turn. On the direct backend with the premium model, the scene context now goes in as a mid-conversation `role: "system"` message immediately before the latest user turn, with the same 1-hour cache tier and the same per-user nonce, so the system prompt and prior history stay a cached prefix across a scene edit and the user's own message is still the last thing the model reads. Because the scene is user-authored text, that message is framed as data (a one-line preamble plus `<scene_context>` delimiters the body cannot close) and screened for prompt-injection patterns, which are redacted rather than rejected. The gateway backend and the non-premium models keep the leading embed, which now runs through the same screen.
