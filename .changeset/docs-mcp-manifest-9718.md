---
"@spawnforge/docs": patch
---

Docs: the MCP command reference at `/mcp` and `/mcp/<category>` loads again in production. The manifest is now a static import that Next.js traces into the serverless function, instead of a runtime `fs` read of a path that never reached `/var/task` (HTTP 500, #9718). A real-file unit test pins the import shape, every page now stamps its deployed commit into `<head>` (`<meta name="spawnforge-docs-commit">`, at least 8 hex chars or `unknown`), and the docs deploy probes the live pages and fails on a non-200, an empty command list, or a page served from a different build than the one just deployed. The commit comparison is case-insensitive on both sides, and a page carrying no stamp is diagnosed by name: `VERCEL_GIT_COMMIT_SHA` reaches the build only when the `spawnforge-docs` Vercel project has "Automatically expose System Environment Variables" enabled, now documented as a prerequisite in `apps/docs/README.md` and `docs/production-support.md` §13.
