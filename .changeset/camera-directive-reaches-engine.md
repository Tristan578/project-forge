---
"web": patch
---

Generated games now use the camera the GDD asked for. The camera directive was
being normalized and then dropped before it reached the engine, so every
generated game — including 2D side-scrollers — ran on the default third-person
follow camera.
