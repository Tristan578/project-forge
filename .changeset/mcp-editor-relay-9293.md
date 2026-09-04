---
"@project-forge/mcp-server": minor
"web": minor
---

The MCP server can finally reach the editor: a loopback relay (`npm run relay` in `mcp-server`) sits between the server and an editor tab opened with `?mcp=<token>`, so the 351 MCP tools execute against the live editor instead of failing with "Not connected". The bridge is opt-in per tab, off in production builds, refuses commands that spend tokens, export or publish, and the server stops retrying a dead URL forever.
