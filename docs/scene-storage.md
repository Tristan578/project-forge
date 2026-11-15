> **Last updated:** 2026-09-16

# Local scene and checkpoint storage

The editor keeps its working scene list and recovery checkpoints in browser storage. Each cloud project has its own local scope, and an unsaved editor uses a separate `unsaved` scope. Opening Project B therefore cannot show, restore, or save a scene buffer or checkpoint created while Project A was active.

Existing browser-global scene data is migrated only when opening the unsaved editor. It is never assigned to a cloud project automatically, because the browser cannot prove which project originally created it. Legacy checkpoints migrate only when they are explicitly anonymous; checkpoint records tagged with a cloud project remain unassigned.

Creators do not need to move data manually. To keep an old local draft, open it from an unsaved editor before creating or opening a cloud project, then save it to the intended project. If an old cloud-project recovery point is absent, use the project’s cloud history or an exported backup rather than restoring it into a different project.
