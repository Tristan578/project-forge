---
"web": patch
---

Reverb zones now actually apply. Authoring a zone dispatched `update_reverb_zone`, a command name the engine has never had a dispatch arm for, and flattened an `enabled` key onto `set_reverb_zone` that serde silently discards — so every reverb zone ever created was configured and never switched on. The store now sends `set_reverb_zone` plus `toggle_reverb_zone`, the inspector's Add button enables the zone it creates (which is what reveals the editing controls, previously unreachable), and inbound engine events route to state-only actions instead of dispatching straight back at the engine.
