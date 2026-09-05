---
"@spawnforge/docs": patch
---

Docs: the MCP command reference at `/mcp` and `/mcp/<category>` loads again in production. The manifest is now a static import that Next.js traces into the serverless function, instead of a runtime `fs` read of a path that never reached `/var/task` (HTTP 500, #9718). A real-file unit test pins the import shape, every page now stamps its deployed commit into `<head>` (`<meta name="spawnforge-docs-commit">`), and the docs deploy probes the live pages and fails on a non-200, an empty command list, or a page served from a different build than the one just deployed.
