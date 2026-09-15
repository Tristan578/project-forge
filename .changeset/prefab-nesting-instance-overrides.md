---
"web": minor
---

Add nested/linked prefab instances with per-field override tracking. A source prefab can now be instantiated as a linked instance that inherits its fields live, while any field you override stays put when the source changes; prefabs can also nest other prefabs, and a cyclic reference is rejected with the offending chain before anything is written. The new Prefabs tab in the Assets panel lets you create instances, nest a prefab, apply a source prefab onto its instances (preserving overrides), and inspect which fields each instance overrides — and the same operations are available to the in-app AI through the `create_prefab_instance`, `nest_prefab`, `apply_prefab_to_instances`, and `list_prefab_instances` commands, which share one validated contract with the manual controls. Instances persist with the scene, keeping their stable ids and overrides across save and reopen.
