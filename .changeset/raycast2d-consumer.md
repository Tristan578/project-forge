---
"web": patch
---

2D raycasts from scripts now return the engine's actual answer. The physics
channel dispatched a command the engine never implemented and read the
acceptance envelope as the result, so `forge.physics2d.raycast` and
`isGrounded` never reported a real hit.
