---
"web": minor
---

Add manual per-system-group CPU timing capture to the performance profiler. A
new "Top costly systems" panel lets you start a bounded capture session and see
which engine system group (scripting, bridge, or physics) a frame spike is
attributable to. Groups the engine does not measure — rendering and GPU timing —
are shown as "unknown" rather than a misleading zero, and long capture sessions
stay memory-bounded and can be stopped at any time.
