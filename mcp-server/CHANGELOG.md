# @project-forge/mcp-server

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
