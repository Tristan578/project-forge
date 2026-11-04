---
"@project-forge/mcp-server": patch
---

Routine dependency refresh, rolled into one change: hono 4.13.16, @hono/node-server 2.1.6, qs 6.17.1, fast-uri 3.1.9 and ip-address 10.7.6 (all transitive, through the MCP SDK and its HTTP stack). The engine picks up serde_json 1.0.154, uuid 1.29.0 and enumset 1.1.15, and CI moves to actions/setup-node 7.1.0, actions/upload-artifact 7.0.2 and chromaui/action 18.11.0. Nothing in the editor, published games or the docs site looks or behaves differently.
