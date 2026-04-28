---
"web": patch
---

Fix `HistoryStack::push_redo()` to enforce `max_size` and set the `dirty` flag, restoring symmetry with `push()` and `push_undo_only()`. Editor "unsaved changes" indicator now reflects redo-state changes after an undo. The cap was previously bounded only implicitly by the in-flight undo flow; making it an explicit invariant of the type narrows the search space for future state-dependent engine panics. Resolves #8531.
