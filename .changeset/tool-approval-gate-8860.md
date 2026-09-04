---
"web": minor
---

Destructive chat-agent tool calls now require your explicit approval before they run. When the AI proposes an action that deletes or replaces existing work — deleting entities, starting a new scene, loading over the current one, overwriting a script — the server blocks it and the chat shows an approval card with the exact arguments the call would run with. Nothing touches your scene until you press Approve, and denying the call sends that decision back to the model so it can carry on without it. Ordinary editing (spawning, transforming, materials, lighting) is unaffected.

Also fixes a bug that broke every multi-turn tool call: the follow-up message the chat sent after running a tool used a format the AI SDK rejects, so the second step of any tool-using turn failed silently.
