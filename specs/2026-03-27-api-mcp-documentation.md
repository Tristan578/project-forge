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

---

## 2. Architecture

### 2.1 Separate Site

| Site | URL | Framework | Content |
|------|-----|-----------|---------|
| Design system | `design.spawnforge.ai` | Storybook 8.6 | Components, tokens, effects |
| API/MCP docs | `docs.spawnforge.ai` | Fumadocs (Next.js) | API reference, MCP commands |

### 2.2 Monorepo Placement

```
project-forge/
  apps/
    docs/                          <- NEW: Fumadocs site
      app/                         <- Next.js App Router pages
      content/                     <- MDX docs (auto-generates sidebar)
        mcp/                       <- MCP command reference (generated)
        api/                       <- OpenAPI reference (generated)
        guides/                    <- Future: user guides
      scripts/
        generate-mcp-docs.ts       <- commands.json → MDX pipeline
        generate-api-docs.ts       <- OpenAPI spec → Fumadocs pages
      fumadocs.config.ts
      package.json
    design/                        <- Storybook (existing from Plan B)
  web/                             <- Main app
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
mcp-server/manifest/commands.json  (canonical source)
        ↓ scripts/generate-mcp-docs.ts
apps/docs/content/mcp/*.mdx        (generated, gitignored)
```

- Reads ONLY from `mcp-server/manifest/commands.json` (NOT `web/src/data/commands.json`)
- Filters: only `visibility: "public"` in public build
- When `INCLUDE_INTERNAL=true`: includes all commands (internal build)
- Generated MDX is `.gitignore`d — regenerated on every build
- `git log -1 --format='%aI|%an' -- mcp-server/manifest/commands.json` provides "Last updated" metadata

### 3.4 CI Gate

```yaml
docs-internal-gate:
  name: Verify Public Docs Exclude Internal Content
  steps:
    - run: cd apps/docs && npm run build  # No INCLUDE_INTERNAL
    - run: |
        # Extract internal command names from manifest
        INTERNAL=$(node -e "
          const cmds = require('../../mcp-server/manifest/commands.json');
          cmds.filter(c => c.visibility !== 'public')
            .forEach(c => console.log(c.name));
        ")
        # Grep built output for internal names
        for name in $INTERNAL; do
          if grep -r "$name" .next/ 2>/dev/null; then
            echo "::error::Internal command '$name' found in public build"
            exit 1
          fi
        done
```

### 3.5 Dual-File Sync Enforcement

Add CI check that `mcp-server/manifest/commands.json` and `web/src/data/commands.json` are structurally identical:

```yaml
- name: Verify MCP manifest sync
  run: |
    diff <(python3 -c "import json; print(json.dumps(json.load(open('mcp-server/manifest/commands.json')), sort_keys=True))") \
         <(python3 -c "import json; print(json.dumps(json.load(open('web/src/data/commands.json')), sort_keys=True))")
```

### 3.6 Manifest Schema Update

Update `mcp-server/src/manifest.test.ts` to validate the `visibility` field:

```ts
// Optional field, defaults to 'internal' if absent
if (cmd.visibility) {
  expect(['public', 'internal']).toContain(cmd.visibility);
}
```

---

## 4. API Reference (OpenAPI)

### 4.1 Generation Strategy

OpenAPI spec generated at build time from route handler Zod schemas (leverages Plan E's withApiMiddleware + Zod work):

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
    "dev": "next dev -p 3001",
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

### 6.2 Content Structure

```
apps/docs/content/
  index.mdx                  <- Landing page
  mcp/
    index.mdx                <- MCP overview
    [generated-per-category]/ <- One MDX per command category
  api/
    index.mdx                <- API overview
    [generated-per-route]/    <- From OpenAPI spec
```

### 6.3 Internal Build Gating

Same pattern as Storybook: `INCLUDE_INTERNAL=true` env var at build time. Public Vercel project does NOT have this var. Internal build deployed to a separate Vercel project with Deployment Protection (SSO).

---

## 7. Two Builds (Public + Internal)

| Build | URL | Content | Protection |
|-------|-----|---------|-----------|
| Public | `docs.spawnforge.ai` | Public MCP commands + public API routes | None (public) |
| Internal | Vercel preview URL or `docs-internal.spawnforge.ai` | All commands + all routes | Vercel Deployment Protection (mandatory) |

CI gate verifies public build contains no internal content (Section 3.4).

---

## 8. Phased Implementation

### Phase 1: Fumadocs scaffold + MCP docs

- Create `apps/docs/` with Fumadocs
- Add `visibility` field to commands.json (agent batch tag)
- Build `generate-mcp-docs.ts` pipeline
- Deploy public docs to `docs.spawnforge.ai`
- CI gate for internal content exclusion
- Dual-file sync CI check

### Phase 2: OpenAPI reference (depends on Plan E completion)

- Build OpenAPI generator from Zod schemas
- Wire `fumadocs-openapi` for interactive API pages
- Internal route exclusion logic
- Deploy updated docs site

### Phase 3: Internal build + polish

- Set up internal Vercel project with Deployment Protection
- Internal build with `INCLUDE_INTERNAL=true`
- Search indexing
- "Last updated" metadata pipeline

---

## 9. Testing Strategy

### Unit Tests
- `generate-mcp-docs.ts`: given commands.json with mixed visibility, assert only public commands in output
- Visibility field validation in `manifest.test.ts`
- Dual-file sync check (structural equality)

### E2E Tests
- `docs.spawnforge.ai` loads, MCP command pages render
- Search returns results for public commands
- No internal command names appear in public build (CI gate)

### Visual Regression
- Chromatic connected to `apps/docs/` for page layout consistency

---

## 10. Success Criteria

- [ ] `docs.spawnforge.ai` serves MCP command reference
- [ ] Only `visibility: "public"` commands appear in public build
- [ ] CI gate fails if internal commands leak to public
- [ ] commands.json dual-file sync enforced in CI
- [ ] OpenAPI reference renders from Zod schemas (after Plan E)
- [ ] Internal build has Vercel Deployment Protection
- [ ] "Last updated" shows canonical source git metadata
- [ ] No AI attribution anywhere on the site
- [ ] Fumadocs search works for public content
