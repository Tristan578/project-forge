---
"spawnforge": patch
---

Fix AccessibilityPanel keybinding cleanup to use ref-based tracking instead of closure values, ensuring stale bindings are always removed when profiles are regenerated
