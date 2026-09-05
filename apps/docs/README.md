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
- **`apps/docs/data/commands.json` in sync** — see the table above; `scripts/check-manifest-sync.ts` fails the build if any copy has drifted

## Environment Variables

No runtime secrets are required for local development. The docs site is statically generated.

For production deployments set:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for sitemap and OG tags |

## Test Suite

All commands must be run from within the `apps/docs/` directory:

```bash
cd apps/docs
npm test        # vitest run — runs scripts, lib, and component tests
```

When run locally with no `MANIFEST_PATH`, `scripts/generate-mcp-docs.ts` reads the canonical
`../../mcp-server/manifest/commands.json` relative to `apps/docs/`; the Vercel build sets
`MANIFEST_PATH=./data/commands.json` because the canonical file is outside the deploy root.

Tests live in:

- `scripts/__tests__/` — Node environment (build-time scripts)
- `lib/__tests__/` — Node environment (shared utilities)
- `components/__tests__/` — jsdom environment (React components)

The vitest config (`vitest.config.ts`) uses `environmentMatchGlobs` to split environments automatically.

## Build Scripts

| Script | Purpose |
|--------|---------|
| `scripts/generate-mcp-docs.ts` | Generates MDX pages from the MCP command manifest (`MANIFEST_PATH`, or the canonical file) |
| `scripts/check-manifest-sync.ts` | Asserts the canonical `commands.json` matches both copies (`web/src/data/`, `apps/docs/data/`) |
| `scripts/ci-gate-check.ts` | CI gate: fails if public command count drops below threshold |
