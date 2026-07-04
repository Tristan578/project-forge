---
"web": patch
---

chore(deps-dev): bump typescript to ^6.0.3 across the workspace (#8904)

Dev-toolchain-only update: aligns the `typescript` devDependency ranges in `web` (`^6` → `^6.0.3`), `mcp-server` (`^6.0.2` → `^6.0.3`), `apps/docs` (`^5` → `^6`), and `packages/ui` (`^5` → `^6`). All workspaces already type-checked cleanly against TypeScript 6 in CI; no runtime or published-artifact changes. The root lockfile was regenerated on Node 24 (`npm install --package-lock-only`) to fix the manifest-mirror drift Dependabot's updater left in two workspace blocks.
