---
"web": patch
---

Fix six unhandled-promise defects and enable `@typescript-eslint/no-floating-promises` so they cannot recur (#8938). Copying the one-time MCP key no longer reports "Copied" when the clipboard write was denied — it previously said so unconditionally, and the key was already dismissed by then. Copying the economy script and the embed snippet now report failure instead of doing nothing. Audio no longer stays muted for the rest of a session when the first resume attempt is rejected: the listeners that retry it were being removed before the resume was known to have succeeded. Pointer lock and four dynamic imports no longer raise unhandled rejections on ordinary paths (an unfocused document, a chunk fetch that fails after a mid-session deploy).
