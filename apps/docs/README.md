# SpawnForge Docs

Fumadocs-based documentation site for the SpawnForge platform API and MCP command reference.

## Dev Setup

```bash
# From the monorepo root — install all dependencies:
npm ci

# Build the design system first (docs imports @spawnforge/ui):
cd packages/ui && npm run build

# Run the docs dev server (port 3001):
cd apps/docs && npm run dev
```

The dev script generates MCP docs from the MCP command manifest before starting Next.js.

## The MCP command manifest — three copies

| Copy | Role |
|------|------|
| `mcp-server/manifest/commands.json` | Canonical source of truth |
| `web/src/data/commands.json` | The editor's copy (one per deploy root) |
| `apps/docs/data/commands.json` | **The copy this site ships.** `lib/commands.ts` imports it statically, so it is what the deployed `/mcp` and `/mcp/<category>` pages render from; `scripts/generate-mcp-docs.ts` reads the same file by path at build time (`MANIFEST_PATH=./data/commands.json` in `vercel.json`) |

All three must stay byte-identical; `scripts/check-manifest-sync.ts` asserts the canonical file matches both copies. The in-root copy exists because the Vercel project's `rootDirectory` is `apps/docs`, so nothing above that directory is present on the build machine — and it must be a static `import`, not a path read at request time, because Next.js output file tracing only ships files it can see as module edges (#9718).

## Build Prerequisites

- **Node 24** — same as the rest of the monorepo (`.node-version`, `engines.node` `>=24.15 <25`)
- **`@spawnforge/ui` built** — `packages/ui/dist/` must exist before `next build` runs
- **`apps/docs/data/commands.json` in sync** — see the table above; `scripts/check-manifest-sync.ts` fails **CI's Docs Internal Gate** if any copy has drifted. It is *not* wired into `npm run build` or `vercel.json`'s `buildCommand`, and the gate is path-filtered (it runs only when `apps/docs/`, `mcp-server/manifest/` or `web/src/data/commands.json` changed), so a build can succeed on a drifted copy — the gate is the enforcement point, not the build

## Environment Variables

No runtime secrets are required for local development. The docs site is statically generated.

For production deployments set:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for sitemap and OG tags |
| `VERCEL_GIT_COMMIT_SHA` | **Set by Vercel, not by you — but only if the project is configured to expose it.** `app/layout.tsx` stamps it into every page as `<meta name="spawnforge-docs-commit">` (`lib/commit.ts`), and `scripts/post-deploy-docs-check.sh` refuses any page that does not carry the commit the deploy just published. See the prerequisite below |

### Required Vercel project setting: expose system environment variables

`VERCEL_GIT_COMMIT_SHA` reaches the build **only** when the `spawnforge-docs`
Vercel project has **"Automatically expose System Environment Variables"**
enabled (Vercel Dashboard → `spawnforge-docs` → Settings → Advanced → System
Environment Variables; `docs/production-support.md` §13 documents the same
toggle for the `spawnforge` project). This is a per-project dashboard setting —
nothing in this repository can turn it on.

With it **off**, every page stamps `unknown`, and `Deploy Docs` fails closed on
every attempt with *"the page reported no commit … built without
`VERCEL_GIT_COMMIT_SHA`"*. That is the intended behaviour — the gate cannot tie
an unstamped page to the deploy under test — but the fix is the toggle, not a
retry. The script's diagnosis names it for exactly this reason.

## Test Suite

All commands must be run from within the `apps/docs/` directory:

```bash
cd apps/docs
npm test        # vitest run — runs scripts, lib, and component tests
```

When run locally with no `MANIFEST_PATH`, `scripts/generate-mcp-docs.ts` reads the canonical
`../../mcp-server/manifest/commands.json` relative to `apps/docs/`; the Vercel build sets
`MANIFEST_PATH=./data/commands.json` because the canonical file is outside the deploy root.

`vitest.config.ts` collects tests with **one broad glob** —
`include: ['**/*.{test,spec}.{ts,tsx}']` — not a per-directory list. A
directory-scoped list silently never collects a test at a path it does not name,
and the author gets a green run for a test that never executed (PF-9453);
`lib/__tests__/testCollection.test.ts` fails if the glob stops matching every
test file in the tree.

Tests live wherever their subject does. Today that is:

- `scripts/__tests__/` — build-time scripts
- `lib/__tests__/` — shared utilities
- `app/__tests__/` — root-layout behaviour (e.g. the commit stamp)
- `components/__tests__/` — React components

The default environment is `node`. `environmentMatchGlobs` was **removed in
vitest 4**, so a file that needs a DOM declares it inline with a
`// @vitest-environment jsdom` directive at the top — that is how the component
tests run under jsdom.

## Build Scripts

| Script | Purpose |
|--------|---------|
| `scripts/generate-mcp-docs.ts` | Generates MDX pages from the MCP command manifest (`MANIFEST_PATH`, or the canonical file) |
| `scripts/check-manifest-sync.ts` | Asserts the canonical `commands.json` matches both copies (`web/src/data/`, `apps/docs/data/`) |
| `scripts/ci-gate-check.ts` | CI gate: fails if public command count drops below threshold |
