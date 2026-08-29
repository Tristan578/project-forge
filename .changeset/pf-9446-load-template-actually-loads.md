---
"web": minor
---

Template Gallery and the `load_template` command now actually apply the template. `sceneSlice.loadTemplate` translates the chosen template into an engine scene file, waits for the entities to appear in the scene graph, and attaches the template's scripts, game components, and input preset. A load that cannot happen — an unknown template id, no engine attached, or a scene the engine accepts and never applies — now reports the failure: the chat command returns an error, the gallery stays open and says why, and the TEMPLATE_USED / TEMPLATE_APPLIED events fire only on a real success. The MCP `load_template` schema also accepts the six 2D templates, which it previously rejected.
