---
"web": patch
---

Document `spawn_entity`'s `id` override in the MCP command manifest. The engine has
accepted a caller-supplied entity id for a while — it is what lets a caller address a
new entity immediately instead of waiting for the async selection event, and the
orchestrator's script and character binding now depend on it — but the manifest
described `spawn_entity` without it, so neither an MCP client nor the chat tool schema
could discover it. Also repairs three mojibake em-dashes in the `play`/`stop`/`pause`
descriptions, which rendered as `â€"` in every MCP client's tool list.
