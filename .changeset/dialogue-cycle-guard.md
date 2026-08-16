---
"web": patch
---

Stop a dialogue tree that loops back on itself from crashing the play session. A conversation whose condition and action nodes formed a cycle recursed until the browser ran out of stack, ending the whole session rather than the one conversation. The runtime now walks such a tree without recursing and ends the conversation if it never reaches anything the player can read. Loops that resolve on their own — "ask again until the counter reaches three" — still play through as authored.
