# @project-forge/mcp-server

## 0.2.3

### Patch Changes

- [#9420](https://github.com/Tristan578/project-forge/pull/9420) [`d7bb9f3`](https://github.com/Tristan578/project-forge/commit/d7bb9f3123801d2ffe73b6b4411d81f1fecc5aed) Thanks [@Tristan578](https://github.com/Tristan578)! - Allow validated MCP HTTP rate-limit overrides while retaining safe production defaults.

- [#9408](https://github.com/Tristan578/project-forge/pull/9408) [`74ea49f`](https://github.com/Tristan578/project-forge/commit/74ea49f6f98358fccf026fe382b973f54b5197a1) Thanks [@Tristan578](https://github.com/Tristan578)! - Make the manifest category snapshot guard detect unexpected category drift.

## 0.2.2

### Patch Changes

- [#9089](https://github.com/Tristan578/project-forge/pull/9089) [`06c5e97`](https://github.com/Tristan578/project-forge/commit/06c5e97daf271b33967b19aaba0128ece04eff49) Thanks [@dependabot](https://github.com/apps/dependabot)! - chore(deps): bump the `hono` security-pin override 4.12.31→4.13.0 ([#9089](https://github.com/Tristan578/project-forge/issues/9089))

  Same shape as [#8995](https://github.com/Tristan578/project-forge/issues/8995): Dependabot's bump only edited the root `package.json` override, and npm does not re-resolve an already-pinned transitive when only its override value changes — so the bump shipped as a silent no-op with the lockfile still on 4.12.31 while Lockfile Sync stayed green (an override-forced package is a documented blind spot of that gate's `npm ls` stage). Relocked on Node 24 via `npm update hono --package-lock-only`; only the `hono` version/resolved/integrity lines changed, and the integrity matches the registry. `hono` reaches the tree through `@modelcontextprotocol/sdk` (mcp-server) and is a peer of `@hono/node-server`.

- [#9100](https://github.com/Tristan578/project-forge/pull/9100) [`fcf39f3`](https://github.com/Tristan578/project-forge/commit/fcf39f3c4678e2b709978b7af2254ab571e5e991) Thanks [@Tristan578](https://github.com/Tristan578)! - chore(deps): relock `nanoid`, `js-yaml` and `dompurify` to clear three published advisories ([#9099](https://github.com/Tristan578/project-forge/issues/9099))

  The `npm audit` gate was red on all three audited workspaces (`.`, `web`, `mcp-server`):

  - **GHSA-2v37-7h3g-55p8** (high) — `nanoid`: a custom generator can loop indefinitely when `size` is zero. `3.3.16` → `3.3.18`.
  - **GHSA-5p4m-2wfm-xmqj** (high) — `js-yaml`: quadratic CPU consumption resolving `!!omap`. `4.3.0` → `4.3.1` at the root, and the two nested `3.15.0` copies (under `gray-matter/` and `read-yaml-file/`) → `3.15.1`. A root-only bump would have left both nested copies vulnerable.
  - **GHSA-55q2-fjhq-7xh7** (moderate) — `dompurify`: an `IN_PLACE` hook removal leaves a detached subtree executable (XSS). The existing root override was pinned `>=3.4.12`, one patch short of the fix, so it actively held the vulnerable version in place; tightened to `>=3.4.13` and relocked to `3.4.13`.

  Every fix was already published, so no `ALLOWED_ADVISORIES` waiver was added — the allowlist stays empty, which is its correct steady state.

  Relocked on the pinned Node 24 toolchain with a scoped `npm update … --package-lock-only`. The committed lockfile carries exactly five changed nodes (`version`/`resolved`/`integrity` only) with zero nodes added or removed; the `libc` metadata that `npm update` strips from 34 Linux-only optional native nodes was restored so the file round-trips through `npm install --package-lock-only` unchanged.

## 0.2.1

### Patch Changes

- [#8995](https://github.com/Tristan578/project-forge/pull/8995) [`7371343`](https://github.com/Tristan578/project-forge/commit/7371343a8c7ac2e5052b0c585d4ea89fca4e9e30) Thanks [@dependabot](https://github.com/apps/dependabot)! - chore(deps): bump the `hono` security-pin override 4.12.26→4.12.31 ([#8995](https://github.com/Tristan578/project-forge/issues/8995))

  Dependabot's bump only edited the root `package.json` override; npm does not re-resolve an already-pinned transitive when only its override changes, so the lockfile kept `hono` at 4.12.26 while Lockfile Sync stayed green (same class as the `@clerk/shared` case in [#8964](https://github.com/Tristan578/project-forge/issues/8964)). Relocked on Node 24 via `npm update hono --package-lock-only` — only the `hono` version/resolved/integrity lines changed, regen verified byte-stable. `hono` reaches the tree through `@modelcontextprotocol/sdk` (mcp-server).

- [#9003](https://github.com/Tristan578/project-forge/pull/9003) [`983d0b5`](https://github.com/Tristan578/project-forge/commit/983d0b5d1efeef1cef925eb028c05e2d28e8165f) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(security): remediate all 10 open Dependabot alerts + the CodeQL alert, and add a scheduled gate so alert debt can't silently accumulate again (PF-1000)

  - **next 16.2.10 → 16.2.11** (`web`): clears 9 Dependabot alerts — SSRF (GHSA-89xv-2m56-2m9x, GHSA-p9j2-gv94-2wf4), middleware bypass (GHSA-6gpp-xcg3-4w24), DoS (GHSA-m99w-x7hq-7vfj), plus mediums.
  - **@hono/node-server override ^1.19.13 → ^2.0.5** (mcp-server, transitive via `@modelcontextprotocol/sdk`): clears GHSA-frvp-7c67-39w9 (Windows serve-static path traversal). The SDK only imports `getRequestListener`, which v2 retains with dual ESM/CJS exports; peer `hono ^4` is satisfied by the pinned 4.12.31. Relock required deleting the stale SDK subtree lock nodes first — npm neither re-resolves an already-pinned transitive on an override change, nor (after deleting only the package's own node) re-adds it.
  - **tools/agentic-sync/sync.mjs**: CodeQL js/incomplete-multi-character-sanitization — comment stripping now runs to a fixed point, so spliced-together bytes (`<!<!-- x -->--`) can no longer smuggle a live `<!-- AGENTIC-SYNC:END -->` sentinel through a single-pass replace.
  - **New scheduled gate** (`scripts/check-security-alerts.sh` + `.github/workflows/security-alerts.yml`): daily + on-demand check that fails while any open Dependabot or code-scanning alert exists (GHSA allowlist mirrors the npm-audit gate's two dev-only esbuild waivers; fails closed on tooling errors). Scheduled rather than PR-blocking because repo-level alerts only close after the fixing PR merges.

## 0.2.0

### Minor Changes

- [#8163](https://github.com/Tristan578/project-forge/pull/8163) [`d9e0f22`](https://github.com/Tristan578/project-forge/commit/d9e0f22dddde2b733f0792ffef1077fa6932306b) Thanks [@Tristan578](https://github.com/Tristan578)! - Adopt Changesets for automated versioning, changelog generation, and release management across the monorepo.

- [#8512](https://github.com/Tristan578/project-forge/pull/8512) [`878d835`](https://github.com/Tristan578/project-forge/commit/878d835272ca2c9c8b37607022bde8b4c23359f9) Thanks [@Tristan578](https://github.com/Tristan578)! - Add Streamable HTTP transport (MCP spec 2025-11-25) alongside the existing stdio transport. Enable with `MCP_TRANSPORT=http` and a Bearer token in `MCP_HTTP_TOKEN`. Supports both stateful (SDK-managed sessions) and stateless (`MCP_HTTP_STATELESS=1`, fresh transport per request) modes, per-IP rate limiting (Upstash with in-memory fallback), an unauthenticated `/health` probe, and a 4MB request body cap.

### Patch Changes

- [#8672](https://github.com/Tristan578/project-forge/pull/8672) [`a195378`](https://github.com/Tristan578/project-forge/commit/a1953783e5f81b465b16028eb37638743ec98803) Thanks [@Tristan578](https://github.com/Tristan578)! - fix(ci): align the Node runtime version across the whole monorepo on the canonical major 24.

  The Node version was declared in many drifting places — `.node-version` (24, used by Vercel) disagreed with `.nvmrc` (20), with `engines.node` (`>=20 <25`), and with 31 hardcoded `node-version: 20` inputs to `actions/setup-node` across every GitHub workflow. CI therefore ran on Node 20 while Vercel built on Node 24, the "green in CI, broken on Vercel" footgun (PF-841, [#8665](https://github.com/Tristan578/project-forge/issues/8665)).

  - `.node-version` is now the single source of truth; every `actions/setup-node` step reads it via `node-version-file: .node-version` instead of a hardcoded literal, so there is exactly one place to bump.
  - `.nvmrc` and `engines.node` (`>=24 <25`) now agree, and the previously engines-less workspaces (`apps/docs`, `apps/design`, `packages/ui`) declare `engines.node`.
  - Dropped the now-obsolete `dependabot.yml` ignore that blocked `portless >=0.13.1` "until we adopt Node 24" — that condition is satisfied.
  - A node-environment vitest guard (`web/src/lib/config/__tests__/nodeVersionConsistency.test.ts`) fails CI if any of these sources drift apart again.

- [#8524](https://github.com/Tristan578/project-forge/pull/8524) [`b466682`](https://github.com/Tristan578/project-forge/commit/b466682d288d2d38d6da3fdece83428d5e4bb486) Thanks [@Tristan578](https://github.com/Tristan578)! - Replace the bearer-token regex in the MCP HTTP transport with a safe slice/trim parser. The previous `/^Bearer\s+(.+)$/i` pattern was a polynomial-ReDoS vector (CodeQL js/polynomial-redos [#59](https://github.com/Tristan578/project-forge/issues/59)) against attacker-controlled `Authorization` headers with long whitespace runs. The new parser runs in linear time.

- [#8406](https://github.com/Tristan578/project-forge/pull/8406) [`3e06d90`](https://github.com/Tristan578/project-forge/commit/3e06d90d8ca347196c4fa334176b1c1c0141b79b) Thanks [@Tristan578](https://github.com/Tristan578)! - Migrate MCP tool registration to non-deprecated registerTool API with ToolAnnotations for better tool discovery

- [#8787](https://github.com/Tristan578/project-forge/pull/8787) [`e971336`](https://github.com/Tristan578/project-forge/commit/e971336c18463d247b027d6db9f4a0be74052e3e) Thanks [@Tristan578](https://github.com/Tristan578)! - Security relock: bump npm `overrides` to clear three newly-published GHSAs that were failing the `Rust Security Audit` (npm-audit) gate on `main` and, by extension, every open PR sharing that gate:

  - `undici` → `^7.28.0` (transitive via `@neondatabase/serverless` / fetch stack)
  - `vite` → `^6.4.3` (transitive dev dep via the design/storybook toolchain)
  - `hono` → `4.12.26` (transitive via `@modelcontextprotocol/sdk`, which ranges `^4.11.4`; the high-severity advisory covers `<=4.12.24`). Pinned exact because `@modelcontextprotocol/sdk` is already at its latest (1.29.0) and an exact override is the only lever — and, critically, npm's _incremental_ `npm install --package-lock-only` (the Lockfile Sync gate's regen) does not honor a _range_ override for an already-pinned transitive, so an exact pin is required for the committed lock to remain a fixpoint of the sync gate.

  Root `package-lock.json` regenerated on the repo's Node 24 toolchain and verified idempotent against the Lockfile Sync gate (a second incremental regen produces no diff) and clean against the npm-audit gate for both `web` and `mcp-server`.

  Also documents a pre-existing OpenAPI drift: `/api/generate/pixel-art/status` shipped to `main` without an `openapi.json` entry or allowlist line. Because the `openapi-route-sync` gate is `pull_request`-only, `main` never tripped it, but every open PR that touches the API surface did. Added to `docs/api/openapi-internal-routes.json` as `async-status` (matching its sibling `sprite-sheet/status` / `tileset-gen/status` polling sub-routes), so this single first-merge clears the OpenAPI gate for the rest of the queue alongside the audit gate.
