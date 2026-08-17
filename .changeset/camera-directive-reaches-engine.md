---
"web": patch
---

Generated games now use the camera the GDD asked for. The camera directive was
being normalized and then dropped before it reached the engine, so every
generated game — including 2D side-scrollers — ran on the default third-person
follow camera.

The camera it creates also has something to follow, the repair path it runs on a
broken scene actually renders, and camera values nobody restates — a sideways
shoulder offset, a tuned follow smoothing — survive the next camera command
instead of snapping back to the engine default. A pipeline step that only
partially applied now says so in the UI rather than reporting plain success.
