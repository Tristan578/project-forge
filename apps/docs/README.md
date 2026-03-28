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

The dev script generates MCP docs from `mcp-server/manifest/commands.json` before starting Next.js.

## Build Prerequisites

- **Node 20+** — same as the rest of the monorepo
- **`@spawnforge/ui` built** — `packages/ui/dist/` must exist before `next build` runs
- **`mcp-server/manifest/commands.json`** — source of truth for MCP command pages; kept in sync with `web/src/data/commands.json` by `scripts/check-manifest-sync.ts`

## Environment Variables

No runtime secrets are required for local development. The docs site is statically generated.

For production deployments set:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for sitemap and OG tags |

## Test Suite

```bash
cd apps/docs
npm test        # vitest run — runs scripts, lib, and component tests
```

Tests live in:

- `scripts/__tests__/` — Node environment (build-time scripts)
- `lib/__tests__/` — Node environment (shared utilities)
- `components/__tests__/` — jsdom environment (React components)

The vitest config (`vitest.config.ts`) uses `environmentMatchGlobs` to split environments automatically.

## Build Scripts

| Script | Purpose |
|--------|---------|
| `scripts/generate-mcp-docs.ts` | Generates MDX pages from `mcp-server/manifest/commands.json` |
| `scripts/check-manifest-sync.ts` | Asserts the two `commands.json` copies are identical |
| `scripts/ci-gate-check.ts` | CI gate: fails if public command count drops below threshold |
