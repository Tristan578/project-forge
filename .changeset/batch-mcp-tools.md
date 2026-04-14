---
"spawnforge-mcp": patch
---

Batch MCP tool registration in chunks of 50 to avoid blocking the event loop during startup. Migrates from deprecated `tool()` to `registerTool()` API.
