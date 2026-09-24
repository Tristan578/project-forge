---
"web": patch
---

A refused Play now explains itself on the desktop editor: the winnability gate's message opens the chat overlay instead of posting to a tab that only the compact drawer renders, and the same `revealChat()` brings the chat into view when an idea is handed to the AI from the idea generator or the welcome screen. `play()` returns `true` only when it dispatched, and fires no analytics for a refused or engine-less Play. The "Make me a game" dialog offers a focused "Play now" button once the build completes; it closes the dialog and leaves a refusal's explanation to the chat overlay (#10166).
