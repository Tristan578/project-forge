# SpawnForge Docs

Fumadocs-based documentation site for the SpawnForge platform API and MCP command reference.

## Dev Setup

```bash
# From the monorepo root — install all dependencies:
npm ci

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
- **`apps/docs/data/commands.json` in sync** — see the table above; `scripts/check-manifest-sync.ts` fails **CI's Docs Internal Gate** if any copy has drifted. It is *not* wired into `npm run build` or `vercel.json`'s `buildCommand`, and the gate is path-filtered (it runs only when `apps/docs/`, `mcp-server/manifest/` or `web/src/data/commands.json` changed), so a build can succeed on a drifted copy — the gate is the enforcement point, not the build

## Environment Variables

No runtime secrets are required for local development. The site is **not** statically
generated: `app/layout.tsx` exports `dynamic = 'force-dynamic'`, so every route —
`/mcp` and `/mcp/[category]` included — renders per request in the serverless
function. That is why the commit stamp below reflects the deployment actually
serving the page.

Origin and deployment identity use the variables below. Authentication is optional
and configured separately. Public docs remain available without Clerk credentials.

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_DOCS_URL` | **Set this** on the Vercel project. Canonical origin for sitemap and OG tags, resolved by `lib/site.ts` |
| `VERCEL_GIT_COMMIT_SHA` | **Do NOT set this — Vercel supplies it per build, and only if the project is configured to expose it.** Adding it as a project env var hardcodes one SHA into every future build, so the deploy gate would report a "DIFFERENT build" forever. `app/layout.tsx` stamps it into every page as `<meta name="spawnforge-docs-commit">` (`lib/commit.ts`), and `scripts/post-deploy-docs-check.sh` refuses any page that does not carry the commit the deploy just published. See the prerequisite below |

### Optional authentication

Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from the matching
Clerk instance to enable authentication. The publishable key is inlined into the
browser build; the secret stays server-side and enables Clerk request middleware.
Omitting both is supported for local development and CI: public docs render,
authentication controls show an unavailable message, and middleware passes through.
A usable publishable key without a secret retains the existing provider behavior,
but middleware protection is inactive; configure the matching pair for authentication.

`next.config.ts` fails builds when the publishable key is malformed or a secret is
set without a publishable key. Remove both to disable authentication, or correct
the pair. These checks validate configuration shape, not live Clerk connectivity.

### Build switches

`MANIFEST_PATH` selects the build-time command manifest; Vercel uses
`./data/commands.json`, while a local unset value reads the canonical repository
copy. `INCLUDE_INTERNAL=true` is for the protected internal deployment and requires
`IS_INTERNAL_DOCS_BUILD`; the public site must not enable internal content.
These switches control generated content, independently of origin, commit stamp,
and optional authentication.

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
npm test        # vitest run — every *.test.ts(x) in the tree (see the directories below)
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
