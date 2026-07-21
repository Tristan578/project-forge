---
"@project-forge/mcp-server": patch
---

chore(deps): bump the `hono` security-pin override 4.12.26→4.12.31 (#8995)

Dependabot's bump only edited the root `package.json` override; npm does not re-resolve an already-pinned transitive when only its override changes, so the lockfile kept `hono` at 4.12.26 while Lockfile Sync stayed green (same class as the `@clerk/shared` case in #8964). Relocked on Node 24 via `npm update hono --package-lock-only` — only the `hono` version/resolved/integrity lines changed, regen verified byte-stable. `hono` reaches the tree through `@modelcontextprotocol/sdk` (mcp-server).
