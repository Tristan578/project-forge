---
"web": patch
---

Undo, redo and restoring a deleted entity now re-report every component they
touch to the editor, so inspectors stop showing a component as missing on an
entity that has it (or keeping one the engine dropped).

The browser learned engine component state only through bridge emitters gated on
the primary selection AND a `Changed<T>` filter, which can see neither a write to
a non-selected entity nor a removal. The history arms and `spawn_from_snapshot`
now queue a `ComponentResync` carrying the state they wrote, drained by the
bridge into the existing change events plus four new removal events. Editing a
component after an undo no longer sends a full-replace command built from a
default.
