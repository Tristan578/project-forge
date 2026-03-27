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

- **Plan A Phase 0** (spec: `docs/superpowers/plans/2026-03-27-design-system-implementation.md`, Tasks A1-A3) must complete first: workspace bootstrap creates the root `package.json` with `workspaces: ["packages/*", "apps/*", "web"]` and the npm workspace structure that this spec's `apps/docs` site lives inside.
- **Phase 2 depends on Plan E** (spec: `docs/superpowers/plans/2026-03-27-plan-e-backend-consolidation.md`): OpenAPI generation requires the `withApiMiddleware` helper's `validate` option (Zod schema). Plan E defines `validate?: ZodSchema` as a flat body schema. The OpenAPI generator extracts this schema from route files to produce the spec. Phase 2 also requires Plan E to add a `public?: boolean` option to `withApiMiddleware` for route visibility — this amendment to Plan E must be coordinated before Phase 2 begins.

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
  if: ${{ needs.ci-gate.outputs.needs-docs == 'true' }}  # Only runs when apps/docs/** or mcp-server/manifest/** changed
  steps:
    - run: cd apps/docs && npm run build  # No INCLUDE_INTERNAL
    - name: Assert no internal commands in generated MDX
      run: tsx apps/docs/scripts/ci-gate-check.ts
```

> The `needs-docs` output is added to the CI gate job's path-change detection, matching `apps/docs/**` and `mcp-server/manifest/**`. This prevents every Rust engine PR from paying the docs build tax (~3-5 min).

The `ci-gate-check.ts` script is structured as a **testable core function** (`checkGate()`) with a thin CLI wrapper. This pattern allows unit testing without `process.exit()` killing the test runner:

```ts
// apps/docs/scripts/ci-gate-check.ts
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface GateResult {
  passed: boolean;
  errors: string[];
  checkedCount: number;
}

/**
 * Core gate logic — testable, no side effects.
 * Tests import and call this directly.
 */
export function checkGate(contentDir: string, manifestPath: string): GateResult {
  const errors: string[] = [];

  if (!fs.existsSync(contentDir)) {
    return { passed: true, errors: [], checkedCount: 0 };
  }

  let manifest: { commands: Array<{ name: string; visibility?: string }> };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    return { passed: false, errors: [`Failed to read manifest: ${manifestPath} — ${err}`], checkedCount: 0 };
  }

  if (!manifest.commands || !Array.isArray(manifest.commands)) {
    return { passed: false, errors: [`Manifest missing .commands array: ${manifestPath}`], checkedCount: 0 };
  }

  const internalCommands = new Set(
    manifest.commands
      .filter((c) => c.visibility !== 'public')
      .map((c) => c.name),
  );

  const mdxFiles = fs.readdirSync(contentDir).filter(f => f.endsWith('.mdx') && f !== 'index.mdx');
  for (const file of mdxFiles) {
    const raw = fs.readFileSync(path.join(contentDir, file), 'utf-8');
    const { data } = matter(raw);

    // commandName MUST be a string — non-string values bypass Set.has() silently
    if (typeof data.commandName !== 'string' || !data.commandName) {
      errors.push(`MDX file '${file}' missing or non-string 'commandName' frontmatter field`);
      continue;
    }

    if (internalCommands.has(data.commandName)) {
      errors.push(`Internal command '${data.commandName}' found in public MDX file '${file}'`);
    }
  }

  return { passed: errors.length === 0, errors, checkedCount: mdxFiles.length };
}

// --- CLI wrapper (only runs when executed directly, not when imported) ---
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  const result = checkGate(
    path.join(__dirname, '../content/mcp'),
    path.join(__dirname, '../../../mcp-server/manifest/commands.json'),
  );
  for (const err of result.errors) {
    console.error(`::error::${err}`);
  }
  if (result.passed) {
    console.log(`CI gate passed: ${result.checkedCount} command pages checked, no internal commands found.`);
  }
  process.exit(result.passed ? 0 : 1);
}
```

**Required frontmatter schema for generated command MDX files:**

```yaml
---
commandName: "create_entity"     # REQUIRED — matches commands.json name field
category: "entity"               # REQUIRED — category for sidebar grouping
visibility: "public"             # REQUIRED — must match commands.json visibility
description: "Creates a new entity in the scene"
---
```

The `generate-mcp-docs.ts` script MUST write all four frontmatter fields for every generated command page. The CI gate checks `commandName` and cross-references against the manifest's internal command set.

**Generated MDX body content.** Each command page MUST include the following sections in the body (after frontmatter), generated from the `commands.json` entry:

1. **Description** — the command's `description` field, rendered as a paragraph
2. **Parameters** — a table with columns: Name, Type, Required, Description. Generated from the command's `parameters` array. If no parameters, show "This command takes no parameters."
3. **Example** — a fenced code block showing an example JSON invocation:
   ```json
   { "command": "create_entity", "args": { "name": "Player", "type": "mesh" } }
   ```
   Generated from the command's `example` field if present, or a synthesized example from the parameter schema with placeholder values if not.
4. **Category** — a link back to the category index page: "Part of the [{category}](/mcp/{category}) command group."

This ensures every command page is a complete reference, not just a description stub.

Unit tests for this script live in `apps/docs/scripts/__tests__/ci-gate-check.test.ts` (see Section 9).

### 3.5 Dual-File Sync Enforcement

`mcp-server/manifest/commands.json` is the **authoritative** source. `web/src/data/commands.json` is a derived copy. Sync always writes from the canonical source to the copy.

The CI check uses **JSON structural comparison** (parse both files, extract `.commands` array, deep-equal on sorted arrays), not text diff, to avoid false failures from formatting differences.

> **Note:** `commands.json` is an object with `{ version, commands, resources }` — the comparison targets the `.commands` array specifically, not the top-level object.

```yaml
- name: Verify MCP manifest sync
  run: |
    tsx apps/docs/scripts/check-manifest-sync.ts
```

The `check-manifest-sync.ts` script uses `__dirname`-relative paths (not `process.cwd()`) and a testable core function:

```ts
// apps/docs/scripts/check-manifest-sync.ts
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

export function checkSync(canonicalPath: string, copyPath: string): { passed: boolean; error?: string } {
  let a, b;
  try {
    a = JSON.parse(fs.readFileSync(canonicalPath, 'utf-8'));
  } catch { return { passed: false, error: `Cannot read canonical manifest: ${canonicalPath}` }; }
  try {
    b = JSON.parse(fs.readFileSync(copyPath, 'utf-8'));
  } catch { return { passed: false, error: `Cannot read copy manifest: ${copyPath}` }; }

  const sort = (arr: Array<{ name: string }>) => [...arr].sort((x, y) => x.name < y.name ? -1 : 1);
  const sa = JSON.stringify(sort(a.commands ?? []));
  const sb = JSON.stringify(sort(b.commands ?? []));
  if (sa !== sb) return { passed: false, error: 'MCP manifests are out of sync' };
  return { passed: true };
}

// CLI wrapper
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  const result = checkSync(
    path.join(repoRoot, 'mcp-server/manifest/commands.json'),
    path.join(repoRoot, 'web/src/data/commands.json'),
  );
  if (!result.passed) { console.error(result.error); process.exit(1); }
  console.log('Manifest sync check passed.');
}
```

The CI step must use `npx tsx` (not bare `tsx`) to resolve from workspace node_modules:

```yaml
- name: Verify MCP manifest sync
  run: npx tsx apps/docs/scripts/check-manifest-sync.ts
```

### 3.6 Manifest Schema Update

Update `mcp-server/src/manifest.test.ts` to validate the `visibility` field. Add as a **new `it` block** (not inline in the existing field check loop) for clear error attribution:

```ts
it.each(manifest.commands)('$name has valid visibility field', (cmd) => {
  expect(
    ['public', 'internal'],
    `Command "${cmd.name}" has visibility "${cmd.visibility}" — must be "public" or "internal"`,
  ).toContain(cmd.visibility);
});
```

This uses `.toContain()` which implicitly asserts the field is defined (undefined is not in the array), and provides a clear error message naming the offending command.

> **Ordering:** The visibility test and the batch tagging MUST ship in the **same PR**. The batch tagging agent runs first (adding `visibility` to every command), then the test is added — never the reverse. This prevents a window where the test fails on commands that haven't been tagged yet.

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

`fumadocs-openapi` renders the spec as interactive pages with try-it-out panels. **This config is added only in Phase 2** — Phase 1 does not install `fumadocs-openapi` or reference `openapi.json` (the file does not exist until Phase 2).

```ts
// apps/docs/fumadocs.config.ts (Phase 2 addition — NOT present in Phase 1)
import { generateFiles } from 'fumadocs-openapi';

export default {
  openapi: {
    input: './public/openapi.json',
    output: './content/api',
  },
};
```

> **Phase 1:** `fumadocs.config.ts` is either absent or contains an empty export. `fumadocs-openapi` is NOT in Phase 1 `package.json` — it is added in Phase 2 alongside the `openapi.json` generator.

### 4.3 Internal Route Exclusion

Routes are **excluded by default** from the public OpenAPI spec. Only routes explicitly annotated with `@public` in their `withApiMiddleware` options are included. This is an allowlist, not a denylist — new routes are invisible until intentionally opted in. No path-pattern matching or denylist.

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
- `{author}` — from a **separate** `git log -1 --format='%an' -- <canonical-source>` call (not pipe-delimited with date, since author names can contain `|`)
- **Canonical source** for MCP docs: `mcp-server/manifest/commands.json`
- **Canonical source** for API docs: the route handler `.ts` file
- If git metadata unavailable (generated files, CI builds): omit author field entirely. Never hardcode a name.
- If the last commit author matches a bot pattern (`/bot\b/i` or `github-actions`): omit the author field. Only display human author names.
- **Author name MUST be HTML-escaped** before interpolation (`<`, `>`, `&`, `"` replaced). Git author names are user-controlled strings.
- **Non-printable character check:** After escaping, test against `/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/`. If any match, omit the author field entirely. This covers ASCII control characters, zero-width spaces, BiDi overrides, and BOM.

### 5.2 Branding

Per design system spec Section 9.1:
- No AI provider/tool attribution anywhere
- Footer: "SpawnForge Documentation — Built by Tristan Nolan"
- Applies to docs site, in-product UI surfaces, commit messages

### 5.3 Visual Identity

The docs site at `docs.spawnforge.ai` is a public SpawnForge property and MUST maintain visual coherence with the editor. Fumadocs CSS variables must be overridden in `apps/docs/app/globals.css` to match SpawnForge brand values:

- **Font family:** Geist Sans (`'Geist Sans', system-ui, sans-serif`) — same as the editor
- **Mono font:** Geist Mono (`'Geist Mono', ui-monospace, monospace`) for code blocks
- **Accent color:** `#3b82f6` (Dark theme accent) for links, active states, and sidebar highlights
- **Background:** `#09090b` (Dark theme `--sf-bg-app`) for page background
- **Surface:** `#18181b` (Dark theme `--sf-bg-surface`) for sidebar and card backgrounds
- **Text:** `#fafafa` (Dark theme `--sf-text`) for primary text
- **Border:** `#27272a` (Dark theme `--sf-border`) for dividers and card borders

These are hardcoded CSS values in `globals.css` (not imported from `@spawnforge/ui`) since the docs site is a separate Next.js app that does not depend on the design system package. If the Dark theme tokens change in `@spawnforge/ui`, the docs site CSS must be updated manually — add a sync comment at the top of the file:

```css
/* SpawnForge brand values — keep in sync with packages/ui/src/tokens/themes.ts (dark theme) */
```

The docs site does NOT support theme switching (always Dark). Multi-theme docs support is out of scope.

---

## 6. Fumadocs Site Structure

### 6.1 package.json

```json
{
  "name": "@spawnforge/docs",
  "private": true,
  "scripts": {
    "dev": "tsx scripts/generate-mcp-docs.ts && next dev -p 3001",
    "build": "tsx scripts/generate-mcp-docs.ts && next build",
    "generate:mcp": "tsx scripts/generate-mcp-docs.ts",
    "generate:api": "tsx scripts/generate-api-docs.ts"
  },
  "dependencies": {
    "fumadocs-core": "^14",
    "fumadocs-ui": "^14",
    "next": "^16",
    "react": "^19",
    "react-dom": "^19",
    "gray-matter": "^4"
  },
  "devDependencies": {
    "tsx": "^4",
    "typescript": "^5"
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
- **Faceted filtering** — filter commands by category and by scope (`scene:read`, `scene:write`, `query:*`, etc.). Accessibility requirements for the filter component:
  - Filter groups use `role="group"` with `aria-labelledby` pointing to the group heading ("Category", "Scope")
  - Individual filter checkboxes are native `<input type="checkbox">` (not custom divs) for built-in keyboard and screen reader support
  - Tab moves through each checkbox in DOM order (browser default for native inputs); Space toggles the focused checkbox. No custom keyboard handling is needed
  - Active filter count announced via `aria-live="polite"` region: "Showing {N} commands" updates when filters change
  - "Clear filters" button has `aria-label="Clear all filters"` and receives focus after activation
  - All filter controls have visible focus indicators (2px solid outline, `--sf-accent` color)
- **Breadcrumbs** — `Docs > MCP Commands > {Category}` on every command page
- **Search zero results** — when search query returns no matches: "No commands found for '{query}'. Try a different keyword or browse by category." When the query is empty (user cleared the input), show the default unfiltered list — no zero-results message.
- **Filter zero results** — when faceted filters produce no matches: "No public commands match these filters." with a "Clear filters" button that resets all active filters. Filter controls remain visible in this state.
- **Phase 1 placeholder** — `/api/index.mdx` in Phase 1 shows: "The REST API reference is coming soon. It will be available once the API middleware ships with schema validation. In the meantime, explore the MCP command reference above." This sets a clear expectation without promising a date.
- **Generation edge cases:**
  - If `generate-mcp-docs.ts` produces zero public commands (all internal), the MCP index page shows: "No public commands available yet. Commands are being reviewed for public documentation."
  - If `commands.json` is malformed or missing, the generation script exits with a clear error and the docs build fails (never deploys a broken site).
  - If search returns zero results, Fumadocs shows its default "No results found" message with the search query highlighted.

Category groups in the sidebar are sorted alphabetically by category name. Sub-items within a category are sorted alphabetically by command name.

### 7.3 Internal-Boundary UX

Public docs pages include an accessible notice at the top of the MCP index page, rendered as a Fumadocs `<Callout>` component (which uses `role="note"` and appropriate ARIA semantics):

```mdx
<Callout type="info" title="Partial listing">
  Some commands require internal access and are not shown here.
  If you are a SpawnForge team member, contact the team for internal documentation access.
</Callout>
```

This applies to category index pages as well when a category has both public and internal commands — the callout states "X additional internal commands are not shown in this view." The count is computed at generation time from the manifest.

### 7.4 Mobile Responsiveness

Fumadocs responsive defaults are accepted for Phase 1 mobile. Mobile is explicitly **out of scope for custom work in Phase 1**. A Phase 3 ticket will be created for mobile verification against 44px touch targets and 320px minimum viewport. Fumadocs 14.x uses Radix-based sidebar collapse and responsive navigation which handles the most common mobile patterns.

**Loading states:** All pages are statically generated at build time (SSG). No client-side data fetching occurs during page load, so no loading skeleton or progress indicator is needed. The generated MDX is pre-rendered HTML — pages load instantly from Vercel's CDN.

---

## 8. Two Builds (Public + Internal)

| Build | URL | Content | Protection |
|-------|-----|---------|-----------|
| Public | `docs.spawnforge.ai` | Public MCP commands + public API routes | None (public) |
| Internal | Vercel preview URL or `docs-internal.spawnforge.ai` | All commands + all routes | Vercel Deployment Protection (mandatory) |

CI gate verifies public build contains no internal content (Section 3.4).

> **IMPORTANT: Deployment timing.** The internal Vercel project is NOT deployed until Phase 3. In Phases 1-2, only the public build ships. The `INCLUDE_INTERNAL` env var must NEVER be set on the public Vercel project. Only the separate internal Vercel project (created in Phase 3 with Deployment Protection enabled) may have it.

**Enforcement mechanism:** The `generate-mcp-docs.ts` script logs the count of public vs internal commands at build time. The CI gate (Section 3.4) is the enforcement — it fails the build if any internal command leaks to generated MDX. As an additional safeguard, the docs `next.config.ts` includes a build-time check using a **custom environment variable** `IS_INTERNAL_DOCS_BUILD`:

```ts
// apps/docs/next.config.ts
if (process.env.INCLUDE_INTERNAL === 'true' && !process.env.IS_INTERNAL_DOCS_BUILD) {
  throw new Error(
    'INCLUDE_INTERNAL=true requires IS_INTERNAL_DOCS_BUILD=true. ' +
    'Only the internal Vercel project (with Deployment Protection) may have these vars.'
  );
}
```

> **Note:** `VERCEL_DEPLOYMENT_PROTECTION` is NOT a real Vercel system env var. The `IS_INTERNAL_DOCS_BUILD` custom var must be manually set on the internal Vercel project alongside `INCLUDE_INTERNAL=true`. Both vars are absent from the public project. The CI gate (Section 3.4) is the primary enforcement; this build-time check is a defense-in-depth safeguard.

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

- **`generate-mcp-docs.ts`**: Same testable-function pattern as `checkGate()` — extract a `generateMcpDocs(manifestPath, outputDir): { generatedCount: number, errors: string[] }` function. Tests call this function with temp directories. Cases:
  - Mixed visibility → only public commands in output directory
  - Malformed/missing `commands.json` → `{ errors: ['...'] }` (not `process.exit`)
  - Zero public commands → generates index with "No public commands available" message
  - Missing `.commands` field → `{ errors: ['...'] }`
  - **Author name sanitization**: given git author `<script>alert(1)</script>` → HTML-escaped or omitted in generated MDX
  - **Author name BiDi override**: given git author with `\u202e` → author field omitted entirely
- **Visibility field validation** in `manifest.test.ts` (see Section 3.6) — ships in same PR as batch tagging
- **Dual-file sync** (`check-manifest-sync.ts`): Tests import `checkSync()` function directly. Cases:
  - Both files match → `{ passed: true }`
  - Files differ → `{ passed: false, error: '...' }`
  - Missing canonical file → `{ passed: false, error: '...path...' }`
  - Missing copy file → `{ passed: false, error: '...path...' }`
  - Empty commands arrays in both → `{ passed: true }`
- **CI gate script** (`ci-gate-check.ts`): tests in `apps/docs/scripts/__tests__/ci-gate-check.test.ts`

  The CI gate script uses `process.exit()` which would kill the test runner if imported directly. Tests MUST extract the core logic into a testable `checkGate(contentDir, manifestPath): { passed: boolean, errors: string[] }` function that returns a result object. The top-level script calls this function and maps the result to `process.exit()`. Tests import and call `checkGate()` directly:

  - Test: given MDX files with only public `commandName` fields → `{ passed: true, errors: [] }`
  - Test: given one MDX file with an internal command's `commandName` → `{ passed: false, errors: ['...'] }`
  - Test: given MDX file missing `commandName` frontmatter → `{ passed: false, errors: ['...missing commandName...'] }`
  - Test: given empty `content/mcp/` directory → `{ passed: true, errors: [] }`
  - Test: given non-existent `content/mcp/` directory → `{ passed: true, errors: [] }`

### E2E Tests

E2E tests run against a **local dev server** started by Playwright's `webServer` config (not the deployed URL), ensuring tests validate the current build artifact:

```ts
// apps/docs/playwright.config.ts
export default defineConfig({
  webServer: {
    command: 'npm run dev',
    port: 3001,
    reuseExistingServer: !process.env.CI,
  },
  // ...
});
```

Test cases:
- Docs site loads at `/`, landing page renders MCP and API sections
- `/mcp` page renders command categories in sidebar
- Search for a known public command returns results
- No internal command names appear in rendered page content (belt-and-suspenders with CI gate)

### Visual Regression

- Chromatic connected to `apps/docs/` for page layout consistency (Phase 3)
- Phase 3 will define snapshot pages and regression thresholds

---

## 11. New Command Checklist Note

When adding a new MCP command (per CLAUDE.md step 15), the `visibility` field MUST be included in the manifest entry. Tag it explicitly as `"public"` or `"internal"` — do not rely on the default.

**Exact CLAUDE.md update** — replace the current step 15 text with:

```
15. `mcp-server/manifest/commands.json` — MCP commands. Set `visibility: 'public'` or `visibility: 'internal'` on every new command (mandatory — manifest tests will fail without it).
```

This update MUST ship in the same PR as the batch tagging and manifest test update — not deferred.

---

## 12. CI Integration Details

### 12.1 `needs-docs` CI Output

The existing `ci-gate` job in `.github/workflows/ci.yml` must be extended:

**1. Add output to the `ci-gate` job outputs block:**
```yaml
needs-docs:
  description: 'Whether apps/docs/** or mcp-server/manifest/** changed'
  value: ${{ steps.changes.outputs.docs }}
```

**2. Extend the `Detect changed paths` bash `run:` block** (the step with `id: changes`):
```bash
docs=false
echo "$CHANGED" | grep -qE '^apps/docs/|^mcp-server/manifest/' && docs=true
echo "docs=$docs" >> "$GITHUB_OUTPUT"
```

**3. Modify the existing `any_code` block** in the same step to include `docs`. The current `ci.yml` uses a multi-line `if` form — add `|| [ "$docs" = "true" ]` to the existing condition. Replace the current block:
```bash
# BEFORE (current ci.yml ~line 53-56):
any_code=false
if [ "$web" = "true" ] || [ "$engine" = "true" ] || [ "$mcp" = "true" ] || [ "$ci" = "true" ]; then
  any_code=true
fi

# AFTER (add docs condition):
any_code=false
if [ "$web" = "true" ] || [ "$engine" = "true" ] || [ "$mcp" = "true" ] || [ "$ci" = "true" ] || [ "$docs" = "true" ]; then
  any_code=true
fi
```
> **IMPORTANT:** Do NOT leave the original block unchanged — `docs` must be included in `any_code` or docs-only PRs will never trigger the docs gate job.

**4. The docs gate job MUST declare `needs: [ci-gate]`:**
```yaml
docs-internal-gate:
  needs: [ci-gate]
  if: ${{ needs.ci-gate.outputs.needs-docs == 'true' }}
```

### 12.2 `apps/docs` Install + Gate Steps

The CI gate job runs from workspace root. Use `npx tsx` (not bare `tsx`) to resolve from workspace node_modules:

```yaml
- run: npm ci  # Workspace root — installs all packages including apps/docs
- name: Generate MCP docs
  run: cd apps/docs && npx tsx scripts/generate-mcp-docs.ts
- name: Assert no internal commands in generated MDX
  run: npx tsx apps/docs/scripts/ci-gate-check.ts
- name: Verify MCP manifest sync
  run: npx tsx apps/docs/scripts/check-manifest-sync.ts
```

The generation step MUST run before the gate check (gate reads generated MDX files).

### 12.3 Content Directory Pre-creation

The `apps/docs/content/mcp/` directory must be created as part of the scaffold (even if empty) and committed to git with a `.gitkeep` file. The `generate-mcp-docs.ts` script creates files in this directory but should not be responsible for creating the directory itself. Fumadocs reads this directory on startup — an absent directory causes a startup error.

The `.gitignore` entry MUST target only generated `.mdx` files, NOT the directory itself — otherwise `.gitkeep` would also be ignored and the directory would not be committed:

```gitignore
# Generated MCP command pages (regenerated on every build)
apps/docs/content/mcp/*.mdx
```

Do NOT use `apps/docs/content/mcp/` (directory pattern) — that ignores `.gitkeep` too.

### 12.4 Phase 2 OpenAPI CI Gate

When Phase 2 ships, a corresponding CI gate must verify no internal route paths appear in `apps/docs/public/openapi.json`. This is a Phase 2 AC, not Phase 1, but is documented here to prevent the gap from being forgotten:

```yaml
- name: Assert no internal routes in OpenAPI spec
  run: tsx apps/docs/scripts/ci-gate-openapi.ts
```

### 12.5 Deployment Protection Prerequisite (Phase 3)

**Hard AC for Phase 3:** The internal Vercel project MUST have Deployment Protection (SSO) enabled **before** the first deployment. This is a prerequisite, not a follow-up.

---

## 13. Success Criteria

### Phase 1 (blocks merge)

- [ ] `docs.spawnforge.ai` serves MCP command reference
- [ ] Only `visibility: "public"` commands appear in public build
- [ ] CI gate fails if internal commands leak to public MDX
- [ ] CI gate fails if any command MDX is missing or non-string `commandName` frontmatter
- [ ] commands.json dual-file sync enforced via `checkSync()` in CI (targeting `.commands` array)
- [ ] Landing page clearly describes MCP vs API paths
- [ ] Category index page has search, alphabetical sidebar, faceted filtering, breadcrumbs
- [ ] Fumadocs `<Callout>` notice on public index page (verify ARIA output, add `role="note"` wrapper if needed)
- [ ] "Last updated" metadata shown on all MCP pages (bot authors omitted, XSS-safe, BiDi-safe)
- [ ] API placeholder on `/api` explains dependency on Plan E
- [ ] Search zero-results and filter zero-results show distinct descriptive messages; empty query shows default list
- [ ] No AI attribution anywhere on the site
- [ ] Docs site uses Geist Sans font, Dark theme accent (#3b82f6), and SpawnForge brand colors
- [ ] Each command page includes: description, parameters table, example JSON, category link
- [ ] Faceted filter uses native checkboxes, `role="group"` + `aria-labelledby`, visible focus indicators, `aria-live` count
- [ ] Generated MDX `.gitignore` pattern is `apps/docs/content/mcp/*.mdx` (not the directory itself)
- [ ] Fumadocs search works for public content
- [ ] `checkGate()` unit tests pass (5 cases including non-string commandName)
- [ ] `checkSync()` unit tests pass (5 cases including missing files)
- [ ] `generateMcpDocs()` unit tests pass (6 cases including author sanitization)
- [ ] CLAUDE.md step 15 updated with visibility field requirement
- [ ] Batch tagging + manifest test + CLAUDE.md update ship in single atomic PR
- [ ] Phase 3 mobile ticket created with PF-XXX ID before Phase 1 closes

### Phase 2 (blocks Phase 2 merge)

- [ ] OpenAPI reference renders from Zod schemas
- [ ] OpenAPI CI gate verifies no internal routes in `openapi.json` (Section 12.4)
- [ ] Plan E amended with `public?: boolean` on `withApiMiddleware` options

### Phase 3 (blocks Phase 3 merge)

- [ ] Internal Vercel project has Deployment Protection enabled before first deploy
- [ ] `IS_INTERNAL_DOCS_BUILD=true` and `INCLUDE_INTERNAL=true` set on internal project only
- [ ] Chromatic visual regression connected with defined snapshot pages and thresholds
