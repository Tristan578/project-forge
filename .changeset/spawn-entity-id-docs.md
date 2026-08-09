---
"web": patch
---

Document `spawn_entity`'s `id` override in the MCP command manifest. The engine has
accepted a caller-supplied entity id for a while — it is what lets a caller address a
new entity immediately instead of waiting for the async selection event, and the
orchestrator's script and character binding now depend on it — but the manifest
described `spawn_entity` without it, so neither an MCP client nor the chat tool schema
could discover it. The chat tool schema deliberately withholds it: the store mints the
id itself and returns it synchronously, so a model-supplied id buys nothing, while a
collision with an existing id would make the engine's id-matching loops address the
wrong entity. Also repairs three mojibake em-dashes in the `play`/`stop`/`pause`
descriptions, which rendered as `â€"` in every MCP client's tool list.
