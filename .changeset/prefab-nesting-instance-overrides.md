---
"web": patch
"@spawnforge/ui": patch
---

Preserve saved prefab link metadata and its source definitions during scene changes, saves, recovery, and game export. Reject cyclic or incomplete imported graphs before writing them, retain stable nesting ids on scene reopen, and keep rejected scene switches attached to the original scene.

The Prefabs panel can inspect saved links and overridden field names. Linked scene placement, nested entity creation, and propagation are unavailable; their controls are disabled and compatibility commands return explicit errors. Existing flat prefab copies remain available. This change does not complete the linked prefab engine workflow tracked in #9811.

Tab navigation now moves keyboard focus with Arrow, Home, and End keys while preventing page scrolling. The Prefabs panel uses labeled, themed controls with readable tab states and mobile touch targets.
