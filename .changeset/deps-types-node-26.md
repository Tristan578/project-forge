---
"web": patch
---

chore(deps-dev): bump @types/node from 25.9.4 to 26.1.0 across the workspace (#8915)

Dev-toolchain-only update: bumps the `@types/node` devDependency ranges in `web` (`^25` → `^26`), `apps/docs` (`^25` → `^26`), and `mcp-server` (`^25.5.0` → `^26.1.0`). Type definitions only — the runtime remains Node 24 per `engines` and `.node-version`; @types/node 26 requires TypeScript >= 5.6, which every workspace clears on TypeScript 6. No runtime or published-artifact changes. The root lockfile was regenerated on Node 24 (`npm install --package-lock-only`) to fix the manifest-mirror drift Dependabot's updater left in the web workspace blocks.
