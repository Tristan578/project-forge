---
"web": patch
---

Reverb zones now actually apply, and survive being duplicated. Authoring a zone dispatched `update_reverb_zone`, a command name the engine has never had a dispatch arm for, and flattened an `enabled` key onto `set_reverb_zone` that serde silently discards — so every reverb zone ever created was configured and never switched on. The store now sends `set_reverb_zone` plus `toggle_reverb_zone`, the inspector's Add button enables the zone it creates (which is what reveals the editing controls, previously unreachable), and inbound engine events route to state-only actions instead of dispatching straight back at the engine.

Separately, duplicating an entity dropped its reverb zone. The engine has two independent restore paths — `spawn_from_snapshot` for undo/redo and `insert_aux_components` for duplication — and reverb was wired into only the first, so Ctrl+D silently discarded a configured zone while undoing a delete kept it. Both fields now restore on the duplicate path, and a source-parity test asserts the two paths agree on every field of `AuxComponentData` so the next one added cannot go missing the same way.
