---
"web": patch
"@project-forge/mcp-server": patch
---

Security relock: bump npm `overrides` to clear three newly-published GHSAs that were failing the `Rust Security Audit` (npm-audit) gate on `main` and, by extension, every open PR sharing that gate:

- `undici` → `^7.28.0` (transitive via `@neondatabase/serverless` / fetch stack)
- `vite` → `^6.4.3` (transitive dev dep via the design/storybook toolchain)
- `hono` → `4.12.26` (transitive via `@modelcontextprotocol/sdk`, which ranges `^4.11.4`; the high-severity advisory covers `<=4.12.24`). Pinned exact because `@modelcontextprotocol/sdk` is already at its latest (1.29.0) and an exact override is the only lever — and, critically, npm's *incremental* `npm install --package-lock-only` (the Lockfile Sync gate's regen) does not honor a *range* override for an already-pinned transitive, so an exact pin is required for the committed lock to remain a fixpoint of the sync gate.

Root `package-lock.json` regenerated on the repo's Node 24 toolchain and verified idempotent against the Lockfile Sync gate (a second incremental regen produces no diff) and clean against the npm-audit gate for both `web` and `mcp-server`.

Also documents a pre-existing OpenAPI drift: `/api/generate/pixel-art/status` shipped to `main` without an `openapi.json` entry or allowlist line. Because the `openapi-route-sync` gate is `pull_request`-only, `main` never tripped it, but every open PR that touches the API surface did. Added to `docs/api/openapi-internal-routes.json` as `async-status` (matching its sibling `sprite-sheet/status` / `tileset-gen/status` polling sub-routes), so this single first-merge clears the OpenAPI gate for the rest of the queue alongside the audit gate.
