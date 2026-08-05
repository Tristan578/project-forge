---
"@project-forge/mcp-server": patch
---

chore(deps): bump the `hono` security-pin override 4.12.31→4.13.0 (#9089)

Same shape as #8995: Dependabot's bump only edited the root `package.json` override, and npm does not re-resolve an already-pinned transitive when only its override value changes — so the bump shipped as a silent no-op with the lockfile still on 4.12.31 while Lockfile Sync stayed green (an override-forced package is a documented blind spot of that gate's `npm ls` stage). Relocked on Node 24 via `npm update hono --package-lock-only`; only the `hono` version/resolved/integrity lines changed, and the integrity matches the registry. `hono` reaches the tree through `@modelcontextprotocol/sdk` (mcp-server) and is a peer of `@hono/node-server`.
