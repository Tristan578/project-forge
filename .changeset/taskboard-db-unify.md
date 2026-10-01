---
---

Fix taskboard HTTP/MCP/sync database-path divergence (#9995): the auto-started HTTP server and the MCP subprocess now always receive an explicit `--db <path>` from `taskboard_runtime.default_db()` instead of only when `TASKBOARD_DB` is set, so they can no longer silently fall back to the taskboard binary's own default and diverge from `github_project_sync.py`. Adds a regression suite proving all three call sites resolve the same path. Start, MCP and sync refuse a missing or empty database, and a new `init` launcher command is the one explicit way a new machine creates the shared database and binds its project. No published package changes.
