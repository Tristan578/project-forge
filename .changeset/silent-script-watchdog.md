---
"web": patch
---

A game whose scripts never call a `forge.*` API no longer stops 5 seconds into Play with "Script timed out — possible infinite loop". The script runner's 5-second watchdog was cleared only when the script worker posted a message, and a script that issued no commands, logs or errors posted none. The worker now acknowledges every tick it finishes. A script that never returns from a tick still trips the watchdog as before.
