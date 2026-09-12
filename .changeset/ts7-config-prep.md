---
"web": patch
---

Adopt the two `tsconfig` changes TypeScript 7 requires, under TypeScript 6.

`baseUrl` is removed from the root config (TS 5+ resolves `paths` relative to the config file without it) and every workspace now states `"types": []` explicitly instead of relying on `@types` auto-discovery. Both are proven no-ops on the current compiler — zero errors across all four workspaces, and `apps/docs` builds clean in its own deploy root.

The compiler itself is deferred until 7.1 ships a stable programmatic API, because 7.0 has none and `typescript-eslint` can only use 6.x.
