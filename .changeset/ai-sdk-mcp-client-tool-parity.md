---
"web": minor
---

Add an AI SDK MCP client (`@ai-sdk/mcp`) and a tool-parity guard. The flag/env-guarded client (`MCP_HTTP_URL` + `MCP_HTTP_TOKEN`) connects to the SpawnForge MCP server's Streamable HTTP transport and is used out-of-band — chiefly to verify the bundled command manifest stays in sync with the tools a live server actually serves. The chat agent intentionally keeps its static, browser-forwarded tool source (no hot-path network dependency, no change to the execution model). See `docs/decisions/2026-06-23-mcp-client-tool-source.md`.
