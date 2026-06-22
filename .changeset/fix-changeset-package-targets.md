---
"web": patch
---

Dependency and changeset hygiene (#8630, #8626, #8732).

- Point the npm Dependabot updater at the repo root (`directory: /`) — the only
  location with a `package-lock.json` in this single-root-lockfile monorepo —
  replacing the `/web` and `/mcp-server` entries that edited manifests they could
  not relock and broke `npm ci` on main (#8655, #8658).
- Retarget every changeset that named a non-workspace package (the root
  `"spawnforge"`, plus `spawnforge-web` / `@spawnforge/web` / `spawnforge-docs` /
  `@spawnforge/mcp-server` typos) to its real workspace package, so
  `changeset version` no longer throws during release assembly.
- Add `scripts/check-changeset-packages.sh`, wired into the Changeset Check
  workflow, to validate every changeset's package name against the workspace and
  prevent this class of defect from recurring (#8325, #8396, #8732).
