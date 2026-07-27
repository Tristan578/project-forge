---
"web": patch
"@project-forge/mcp-server": patch
---

fix(security): remediate all 10 open Dependabot alerts + the CodeQL alert, and add a scheduled gate so alert debt can't silently accumulate again (PF-1000)

- **next 16.2.10 → 16.2.11** (`web`): clears 9 Dependabot alerts — SSRF (GHSA-89xv-2m56-2m9x, GHSA-p9j2-gv94-2wf4), middleware bypass (GHSA-6gpp-xcg3-4w24), DoS (GHSA-m99w-x7hq-7vfj), plus mediums.
- **@hono/node-server override ^1.19.13 → ^2.0.5** (mcp-server, transitive via `@modelcontextprotocol/sdk`): clears GHSA-frvp-7c67-39w9 (Windows serve-static path traversal). The SDK only imports `getRequestListener`, which v2 retains with dual ESM/CJS exports; peer `hono ^4` is satisfied by the pinned 4.12.31. Relock required deleting the stale SDK subtree lock nodes first — npm neither re-resolves an already-pinned transitive on an override change, nor (after deleting only the package's own node) re-adds it.
- **tools/agentic-sync/sync.mjs**: CodeQL js/incomplete-multi-character-sanitization — comment stripping now runs to a fixed point, so spliced-together bytes (`<!<!-- x -->--`) can no longer smuggle a live `<!-- AGENTIC-SYNC:END -->` sentinel through a single-pass replace.
- **New scheduled gate** (`scripts/check-security-alerts.sh` + `.github/workflows/security-alerts.yml`): daily + on-demand check that fails while any open Dependabot or code-scanning alert exists (GHSA allowlist mirrors the npm-audit gate's two dev-only esbuild waivers; fails closed on tooling errors). Scheduled rather than PR-blocking because repo-level alerts only close after the fixing PR merges.
