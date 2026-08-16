---
"web": patch
---

Stop a malformed dialogue tree from crashing the play session. A conversation whose condition and action nodes formed a cycle recursed until the browser ran out of stack, ending the whole session rather than the one conversation. The runtime now walks such a tree without recursing and ends the conversation if it never reaches anything the player can read. Loops that resolve on their own — "ask again until the counter reaches three" — still play through as authored.

Two neighbouring crashes from the same source are closed with it: a condition nested thousands of levels deep no longer overflows the stack when it is evaluated (it is treated as unmet instead, so a gated choice stays hidden rather than opening), and a line that points at a node which is not in the tree now ends the conversation with an explanation instead of leaving the player in an empty dialogue box with no way out but Esc.
