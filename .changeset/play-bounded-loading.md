---
"web": patch
---

Published games no longer hang on an indefinite spinner. The `/play` metadata fetch and the WASM engine load are each bounded by a deadline, a failure of either now surfaces a message naming what timed out instead of leaving "Loading game..." or "Starting engine..." on screen forever, and both failures are reported to error tracking. A failure that happens before the engine takes the canvas offers a retry.
