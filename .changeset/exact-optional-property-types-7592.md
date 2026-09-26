---
"@spawnforge/docs": patch
"@project-forge/mcp-server": patch
"@spawnforge/ui": patch
---

Enable `exactOptionalPropertyTypes` in the three small TypeScript workspaces (#7592).

`apps/docs`, `mcp-server` and `packages/ui` now distinguish an omitted optional property from one set to `undefined`. The handful of sites that relied on the old equivalence build their objects and JSX props with conditional spread instead, so no serialized output gains a literal `undefined` key. The stateless MCP HTTP transport drops its explicit `sessionIdGenerator: undefined` (the SDK gates stateless mode on the option being falsy, so an absent key is identical). No runtime behaviour changes. `web` is not touched: it measures 320 errors across 165 files and is tracked separately.
