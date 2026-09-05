---
"@spawnforge/docs": patch
---

Docs: the MCP command reference at `/mcp` and `/mcp/<category>` loads again in production. The manifest is now a static import that Next.js traces into the serverless function, instead of a runtime `fs` read of a path that never reached `/var/task` (HTTP 500, #9718). A real-file unit test pins the import shape, and the docs deploy now probes the live pages and fails on a non-200 or an empty command list.
