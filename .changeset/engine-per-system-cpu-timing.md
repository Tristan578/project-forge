---
"web": minor
---

Add manual per-system-group CPU timing capture to the performance profiler. A
new "Top costly systems" panel lets you start a bounded capture session and see
which engine system group a frame spike is attributable to. Each group is named
for exactly what it measures — "Entity sync" (the per-frame entity-state emit),
"Transform apply" (the transform command drain) and "Physics" (Rapier's real
simulation step) — so the panel never over-claims cost it cannot see, such as
user-script CPU that runs off-frame in the JS worker. Groups the engine does not
measure — rendering and GPU timing — are shown as "unknown" rather than a
misleading zero, and long capture sessions stay memory-bounded and can be
stopped at any time.
