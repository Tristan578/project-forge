# SpawnForge API & MCP Documentation System

**Spec ID:** 2026-03-27-api-mcp-documentation
**Status:** Draft
**Date:** 2026-03-27

---

## 1. Overview

A dedicated documentation site at `docs.spawnforge.ai` serving API reference (OpenAPI) and MCP command reference. Separate from the design system Storybook at `design.spawnforge.ai`.

### Goals

1. Public MCP command reference for integrators (visibility-gated, safe by default)
2. Interactive OpenAPI reference generated from route handler Zod schemas
3. Internal-only docs for admin/billing routes (build-time gated)
4. Auto-generated "Last updated" metadata from canonical source files
5. Consistent branding (no AI attribution, per Section 9.1 of design system spec)

### Non-Goals

- User-facing tutorials or guides (future)
- Versioned API docs (v1/v2 — future, when API versioning ships)
- Self-hosted search beyond Fumadocs built-in Orama

### Prerequisites

- **Plan A Phase 0** must complete first: workspace bootstrap creates the `apps/` directory that this spec's `apps/docs` site lives inside.
- **Phase 2 depends on Plan E**: OpenAPI generation requires the `withApiMiddleware` `validate` field (Zod schema extraction) introduced in Plan E.

---

## 2. Architecture

### 2.1 Separate Site

| Site | URL | Framework | Content |
|------|-----|-----------|---------|
| Design system | `design.spawnforge.ai` | Storybook 8.6 | Components, tokens, effects |
| API/MCP docs | `docs.spawnforge.ai` | Fumadocs (Next.js) | API reference, MCP commands |

### 2.2 Monorepo Placement

The `apps/docs` directory is created inside the workspace structure set up by Plan A Phase 0. It sits alongside `apps/design` (Storybook) in the monorepo root.

```
project-forge/
  apps/                              <- Created by Plan A Phase 0 workspace bootstrap
    docs/                            <- NEW: Fumadocs site (this spec)
      app/                           <- Next.js App Router pages
      content/                       <- MDX docs (auto-generates sidebar)
        mcp/                         <- MCP command reference (generated)
        api/                         <- OpenAPI reference (generated)
        guides/                      <- Future: user guides
      scripts/
        generate-mcp-docs.ts         <- commands.json → MDX pipeline
        generate-api-docs.ts         <- OpenAPI spec → Fumadocs pages
        ci-gate-check.ts             <- Node script: assert no internal content in MDX
      fumadocs.config.ts
      package.json
    design/                          <- Storybook (existing from Plan B)
  web/                               <- Main app
```

### 2.3 DNS Setup (User Action)

Cloudflare CNAME: `docs` → `cname.vercel-dns.com` (grey cloud / DNS-only)
Vercel project: `spawnforge-docs`, root directory: `apps/docs`

---

## 3. MCP Command Reference

### 3.1 Visibility Field

Add `visibility` field to `mcp-server/manifest/commands.json` schema:

```json
{
  "name": "create_entity",
  "visibility": "public",
  ...
}
```

- **Default: `"internal"`** — safe by default. Commands without the field are treated as internal.
- **Values:** `"public"` | `"internal"`
- **Only `"public"` commands appear on `docs.spawnforge.ai`**

When adding a new command, include the `visibility` field explicitly. Commands missing the `visibility` field default to `"internal"` but must be tagged intentionally — see Section 3.6 for the manifest test warning and the New Command Checklist note in Section 11.

### 3.2 Initial Tagging (Agent Batch)

Agent performs a one-time batch pass using `requiredScope` as a heuristic:

| Scope Pattern | Default Visibility | Rationale |
|--------------|-------------------|-----------|
| `scene:read`, `scene:write` | `public` | Core editor commands — integrators need these |
| `query:*` | `public` | Read-only queries safe for external use |
| `generation:*` | `internal` | Token-metered, not for external automation |
| `project:*` | `internal` | Account/project management |
| `admin:*` | `internal` | Admin-only operations |
| `billing:*` | `internal` | Payment/subscription internals |

After batch tagging, generate a summary for human review: "Tagged X commands as public, Y as internal. Review at `mcp-server/manifest/visibility-review.md`."

### 3.3 Build Pipeline

```
mcp-server/manifest/commands.json  (canonical, authoritative source)
        ↓ scripts/generate-mcp-docs.ts
apps/docs/content/mcp/*.mdx        (generated, gitignored)
```

- Reads ONLY from `mcp-server/manifest/commands.json` — this is the authoritative source.
- Sync writes TO `web/src/data/commands.json` from `mcp-server/manifest/commands.json`, never the reverse.
- Filters: only `visibility: "public"` in public build
- When `INCLUDE_INTERNAL=true`: includes all commands (internal build)
- Generated MDX is `.gitignore`d — regenerated on every build
- `git log -1 --format='%aI|%an' -- mcp-server/manifest/commands.json` provides "Last updated" metadata

### 3.4 CI Gate

The CI gate reads the **generated MDX files** directly — it does not grep the built `.next/` output (which may produce false positives due to minification or hashing of internal command names). The check runs a Node.js script that parses MDX frontmatter and asserts no internal command appears in any public-build MDX file:

```yaml
docs-internal-gate:
  name: Verify Public Docs Exclude Internal Content
  steps:
    - run: cd apps/docs && npm run build  # No INCLUDE_INTERNAL
    - name: Assert no internal commands in generated MDX
      run: node apps/docs/scripts/ci-gate-check.ts
```

The `ci-gate-check.ts` script:

```ts
// apps/docs/scripts/ci-gate-check.ts
// Reads generated MDX frontmatter and asserts visibility == 'public' for all entries.
// This avoids false positives from grepping minified .next/ output.
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const mcpContentDir = path.join(__dirname, '../content/mcp');
const commandsManifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../../mcp-server/manifest/commands.json'), 'utf-8'),
);
const internalCommands = new Set(
  commandsManifest
    .filter((c: { visibility?: string }) => c.visibility !== 'public')
    .map((c: { name: string }) => c.name),
);

let failed = false;
const mdxFiles = fs.readdirSync(mcpContentDir).filter(f => f.endsWith('.mdx'));
for (const file of mdxFiles) {
  const raw = fs.readFileSync(path.join(mcpContentDir, file), 'utf-8');
  const { data } = matter(raw);
  if (data.commandName && internalCommands.has(data.commandName)) {
    console.error(`::error::Internal command '${data.commandName}' found in public MDX file '${file}'`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('CI gate passed: no internal commands found in generated MDX.');
```

Unit tests for this script live in `apps/docs/scripts/__tests__/ci-gate-check.test.ts` (see Section 9).

### 3.5 Dual-File Sync Enforcement

`mcp-server/manifest/commands.json` is the **authoritative** source. `web/src/data/commands.json` is a derived copy. Sync always writes from the canonical source to the copy.

The CI check uses **JSON structural comparison** (parse both files and deep-equal on sorted arrays), not text diff, to avoid false failures from formatting differences:

```yaml
- name: Verify MCP manifest sync
  run: node -e "
    const a = JSON.parse(require('fs').readFileSync('mcp-server/manifest/commands.json','utf-8'));
    const b = JSON.parse(require('fs').readFileSync('web/src/data/commands.json','utf-8'));
    const sort = arr => arr.slice().sort((x,y) => x.name < y.name ? -1 : 1);
    const sa = JSON.stringify(sort(a));
    const sb = JSON.stringify(sort(b));
    if (sa !== sb) { console.error('MCP manifests are out of sync'); process.exit(1); }
    console.log('Manifest sync check passed.');
  "
```

### 3.6 Manifest Schema Update

Update `mcp-server/src/manifest.test.ts` to validate the `visibility` field:

```ts
// Optional field, defaults to 'internal' if absent
if (cmd.visibility) {
  expect(['public', 'internal']).toContain(cmd.visibility);
}

// Warning: commands without an explicit visibility field
if (!cmd.visibility) {
  console.warn(`[manifest] Command '${cmd.name}' is missing a visibility field. Defaulting to 'internal'. Tag explicitly to suppress this warning.`);
}
```

---

## 4. API Reference (OpenAPI)

> **Depends on Plan E completion** — OpenAPI generation requires the `withApiMiddleware` `validate` field (Zod schema extraction) that Plan E introduces. Phase 2 cannot start until Plan E ships.

### 4.1 Generation Strategy

OpenAPI spec generated at build time from route handler Zod schemas:

```ts
// web/src/lib/api/openapi.ts
// Collects Zod schemas from withApiMiddleware routes
// Generates OpenAPI 3.1 spec as JSON
```

The generator:
1. Scans all route files using `withApiMiddleware`
2. Extracts the `validate` Zod schema + route method + path
3. Converts Zod → JSON Schema → OpenAPI path entries
4. Outputs `apps/docs/public/openapi.json`

### 4.2 Fumadocs OpenAPI Integration

`fumadocs-openapi` renders the spec as interactive pages with try-it-out panels:

```ts
// apps/docs/fumadocs.config.ts
import { generateFiles } from 'fumadocs-openapi';

export default {
  openapi: {
    input: './public/openapi.json',
    output: './content/api',
  },
};
```

### 4.3 Internal Route Exclusion

Routes with `requireAuth: true` AND matching internal patterns (`/api/admin/*`, `/api/billing/internal/*`) are excluded from the public OpenAPI spec. The generator reads a `publicRoutes` allowlist or uses route-level `@public` annotations.

When `INCLUDE_INTERNAL=true`, all routes are included (internal build).

---

## 5. Metadata & Attribution

### 5.1 Last Updated

Every generated page footer shows:

```
Last updated: {date} by {author}
```

This metadata is included **starting in Phase 1** (not deferred to Phase 3), so every MCP command page ships with accurate attribution from day one.

- `{date}` — ISO 8601 from `git log -1 --format='%aI' -- <canonical-source>`
- `{author}` — from `git log -1 --format='%an' -- <canonical-source>`
- **Canonical source** for MCP docs: `mcp-server/manifest/commands.json`
- **Canonical source** for API docs: the route handler `.ts` file
- If git metadata unavailable (generated files, CI builds): omit author field entirely. Never hardcode a name.

### 5.2 Branding

Per design system spec Section 9.1:
- No AI provider/tool attribution anywhere
- Footer: "SpawnForge Documentation — Built by Tristan Nolan"
- Applies to docs site, in-product UI surfaces, commit messages

---

## 6. Fumadocs Site Structure

### 6.1 package.json

```json
{
  "name": "@spawnforge/docs",
  "private": true,
  "scripts": {
    "dev": "node scripts/generate-mcp-docs.ts && next dev -p 3001",
    "build": "node scripts/generate-mcp-docs.ts && next build",
    "generate:mcp": "node scripts/generate-mcp-docs.ts",
    "generate:api": "node scripts/generate-api-docs.ts"
  },
  "dependencies": {
    "fumadocs-core": "^14",
    "fumadocs-ui": "^14",
    "fumadocs-openapi": "^5",
    "next": "^16",
    "react": "^19",
    "react-dom": "^19"
  }
}
```

The `dev` script runs `generate-mcp-docs.ts` before starting the Next.js dev server so that Fumadocs has generated MDX files to read from when it initialises. Without this step the dev server starts but the `content/mcp/` directory is empty, causing Fumadocs sidebar errors.

### 6.2 Content Structure

```
apps/docs/content/
  index.mdx                  <- Landing page (see Section 7.3)
  mcp/
    index.mdx                <- MCP command index with search + category sidebar
    [generated-per-category]/ <- One MDX per command category
  api/
    index.mdx                <- API overview
    [generated-per-route]/    <- From OpenAPI spec
```

### 6.3 Internal Build Gating

Same pattern as Storybook: `INCLUDE_INTERNAL=true` env var at build time. Public Vercel project does NOT have this var. Internal build deployed to a separate Vercel project with Deployment Protection (SSO).

---

## 7. Navigation Architecture

### 7.1 Site Structure

The docs site has two top-level paths with clear separation:

| Path | Purpose |
|------|---------|
| `/mcp` | MCP command reference for integrators |
| `/api` | OpenAPI REST reference |

The **landing page** (`/`) presents both paths with clear descriptions:

- **MCP Commands** — "Control SpawnForge from AI tools. Browse the 350+ commands available to Claude and other MCP clients."
- **API Reference** — "REST API for external integrations. Authenticate with your API key and call SpawnForge endpoints directly."

### 7.2 MCP Command Index Page (`/mcp`)

The MCP index page (`content/mcp/index.mdx`) provides:

- **Search bar** — full-text search across all command names and descriptions (Fumadocs Orama built-in)
- **Category sidebar** — 37 categories listed alphabetically in the left navigation, each linking to its category page
- **Faceted filtering** — filter commands by category and by scope (`scene:read`, `scene:write`, `query:*`, etc.)
- **Breadcrumbs** — `Docs > MCP Commands > {Category}` on every command page
- **Zero results state** — when search returns no matches: "No commands found for '{query}'. Try a different keyword or browse by category."
- **Phase 1 placeholder** — "API reference is available after the next release." shown on `/api/index.mdx` in Phase 1 before Plan E completes.

Category groups in the sidebar are sorted alphabetically by category name. Sub-items within a category are sorted alphabetically by command name.

### 7.3 Internal-Boundary UX

Public docs pages include a notice at the top of the MCP index page:

> **Note:** Some commands require internal access and are not shown here. If you are a SpawnForge team member and need access to internal command documentation, [request access here](#).

This applies to the category index pages as well when a category has both public and internal commands — a note states "X additional internal commands are not shown in this view."

### 7.4 Mobile Responsiveness

Fumadocs responsive defaults are accepted for mobile. No custom breakpoints or mobile-specific overrides are required in Phase 1. The built-in Fumadocs sidebar collapse and responsive layout are sufficient.

---

## 8. Two Builds (Public + Internal)

| Build | URL | Content | Protection |
|-------|-----|---------|-----------|
| Public | `docs.spawnforge.ai` | Public MCP commands + public API routes | None (public) |
| Internal | Vercel preview URL or `docs-internal.spawnforge.ai` | All commands + all routes | Vercel Deployment Protection (mandatory) |

CI gate verifies public build contains no internal content (Section 3.4).

---

## 9. Phased Implementation

### Phase 1: Fumadocs scaffold + MCP docs

- Create `apps/docs/` inside the workspace structure from Plan A Phase 0
- Add `visibility` field to commands.json (agent batch tag)
- Build `generate-mcp-docs.ts` pipeline
- Deploy public docs to `docs.spawnforge.ai`
- CI gate for internal content exclusion (Node.js MDX frontmatter check)
- Dual-file sync CI check (JSON structural comparison)
- Navigation: command index with search + category sidebar + faceted filtering + breadcrumbs
- Landing page with clear MCP vs API path descriptions
- Internal-boundary UX notice on public pages
- "Last updated" metadata on all generated pages
- "API reference available after next release" placeholder on `/api`

### Phase 2: OpenAPI reference (depends on Plan E completion)

- Build OpenAPI generator from Zod schemas
- Wire `fumadocs-openapi` for interactive API pages
- Internal route exclusion logic
- Deploy updated docs site

### Phase 3: Internal build + polish

- Set up internal Vercel project with Deployment Protection
- Internal build with `INCLUDE_INTERNAL=true`
- Search indexing tuning
- Chromatic visual regression for docs pages

---

## 10. Testing Strategy

### Unit Tests

- `generate-mcp-docs.ts`: given commands.json with mixed visibility, assert only public commands in output
- Visibility field validation in `manifest.test.ts` (with missing-field warning, see Section 3.6)
- Dual-file sync check: parse both JSON files, deep-equal on name-sorted arrays (not text diff)
- **CI gate script** (`ci-gate-check.ts`): unit tests in `apps/docs/scripts/__tests__/ci-gate-check.test.ts`
  - Test: given MDX files with only public commands, script exits 0
  - Test: given one MDX file with an internal command's `commandName` in frontmatter, script exits 1
  - Test: given empty `content/mcp/` directory, script exits 0 (no files = nothing to flag)

### E2E Tests

- `docs.spawnforge.ai` loads, MCP command pages render
- Search returns results for public commands
- No internal command names appear in public build (enforced by CI gate script)

### Visual Regression

- Chromatic connected to `apps/docs/` for page layout consistency (Phase 3)

---

## 11. New Command Checklist Note

When adding a new MCP command (per CLAUDE.md step 15), the `visibility` field MUST be included in the manifest entry. Tag it explicitly as `"public"` or `"internal"` — do not rely on the default. Update CLAUDE.md step 15 to include: "Set `visibility: 'public'` or `visibility: 'internal'` on every new command."

---

## 12. Success Criteria

- [ ] `docs.spawnforge.ai` serves MCP command reference
- [ ] Only `visibility: "public"` commands appear in public build
- [ ] CI gate (Node.js MDX frontmatter check) fails if internal commands leak to public
- [ ] commands.json dual-file sync enforced via JSON structural comparison in CI
- [ ] Landing page clearly describes MCP vs API paths
- [ ] Category index page has search, alphabetical sidebar, faceted filtering, breadcrumbs
- [ ] "Some commands require internal access" notice on public index page
- [ ] "Last updated" metadata shown on all Phase 1 MCP pages
- [ ] "API reference available after next release" placeholder on `/api` in Phase 1
- [ ] Zero-results search state shows descriptive message
- [ ] Fumadocs mobile responsiveness accepted as-is (no custom overrides needed)
- [ ] OpenAPI reference renders from Zod schemas (after Plan E — Phase 2)
- [ ] Internal build has Vercel Deployment Protection (Phase 3)
- [ ] No AI attribution anywhere on the site
- [ ] Fumadocs search works for public content
- [ ] CI gate script has unit tests covering pass, fail, and empty-directory cases
