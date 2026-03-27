# SpawnForge API/MCP Documentation — Implementation Plan G

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy `docs.spawnforge.ai` — a Fumadocs-powered documentation site serving MCP command reference (Phase 1) and OpenAPI reference (Phase 2).

**Spec:** `specs/2026-03-27-api-mcp-documentation.md` (5/5 reviewer approved after Round 4)

**Prerequisites:**
- Plan A (workspace bootstrap) MUST be complete — `packages/*`, `apps/*`, `web` workspace structure exists
- Plan E (API middleware) MUST be complete before Phase 2 — `withApiMiddleware` has `validate` + `public` options

**Tech Stack:** Fumadocs 14, Next.js 16, gray-matter, tsx, Orama search (built-in), Geist Sans/Mono

---

## Cross-Plan Dependencies

```
Plan A (Foundation) ──► Plan G Phase 1 (Fumadocs scaffold + MCP docs)
Plan E (Backend)    ──► Plan G Phase 2 (OpenAPI reference)
```

Phase 1 can start immediately after Plan A merges. Phase 2 blocks on Plan E.

---

# Phase 1: Fumadocs Scaffold + MCP Docs

## Task G1: Scaffold `apps/docs` Fumadocs site

**Files:**
- Create: `apps/docs/package.json`
- Create: `apps/docs/tsconfig.json`
- Create: `apps/docs/next.config.ts`
- Create: `apps/docs/app/layout.tsx`
- Create: `apps/docs/app/globals.css`
- Create: `apps/docs/app/page.tsx`
- Create: `apps/docs/content/mcp/.gitkeep`
- Create: `apps/docs/content/mcp/index.mdx`
- Create: `apps/docs/content/api/index.mdx`
- Create: `apps/docs/content/index.mdx`
- Modify: `.gitignore` (add `apps/docs/content/mcp/*.mdx`)

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p apps/docs/{app,content/{mcp,api},scripts,public}
touch apps/docs/content/mcp/.gitkeep
```

- [ ] **Step 2: Write apps/docs/package.json**

Per spec Section 6.1:
```json
{
  "name": "@spawnforge/docs",
  "private": true,
  "scripts": {
    "dev": "tsx scripts/generate-mcp-docs.ts && next dev -p 3001",
    "build": "tsx scripts/generate-mcp-docs.ts && next build",
    "start": "next start -p 3001",
    "test": "vitest run",
    "test:e2e": "playwright test"
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
    "typescript": "^5",
    "vitest": "^4",
    "@playwright/test": "^1"
  }
}
```

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", ".next"]
}
```

- [ ] **Step 4: Write next.config.ts with internal build guard**

Per spec Section 8:
```ts
import type { NextConfig } from 'next';

// Defense-in-depth: INCLUDE_INTERNAL requires IS_INTERNAL_DOCS_BUILD
if (process.env.INCLUDE_INTERNAL === 'true' && !process.env.IS_INTERNAL_DOCS_BUILD) {
  throw new Error(
    'INCLUDE_INTERNAL=true requires IS_INTERNAL_DOCS_BUILD=true. ' +
    'Only the internal Vercel project (with Deployment Protection) may have these vars.'
  );
}

const nextConfig: NextConfig = {};
export default nextConfig;
```

- [ ] **Step 5: Write globals.css with SpawnForge brand values**

Per spec Section 5.3:
```css
/* SpawnForge brand values — keep in sync with packages/ui/src/tokens/themes.ts (dark theme) */
@import "tailwindcss";

:root {
  --background: #09090b;
  --foreground: #fafafa;
  --muted: #18181b;
  --border: #27272a;
  --accent: #3b82f6;
  font-family: 'Geist Sans', system-ui, sans-serif;
}

code, pre {
  font-family: 'Geist Mono', ui-monospace, monospace;
}
```

- [ ] **Step 6: Write root layout**

```tsx
// apps/docs/app/layout.tsx
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'SpawnForge Documentation',
  description: 'API reference and MCP command documentation for SpawnForge',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Write landing page**

Per spec Section 7.1:
```tsx
// apps/docs/app/page.tsx
export default function DocsHome() {
  return (
    <main>
      <h1>SpawnForge Documentation</h1>
      <ul>
        <li>
          <a href="/mcp"><strong>MCP Commands</strong></a> — Control SpawnForge from AI tools. Browse the 350+ commands available to Claude and other MCP clients.
        </li>
        <li>
          <a href="/api"><strong>API Reference</strong></a> — REST API for external integrations. Authenticate with your API key and call SpawnForge endpoints directly.
        </li>
      </ul>
      <footer>SpawnForge Documentation — Built by Tristan Nolan</footer>
    </main>
  );
}
```

- [ ] **Step 8: Write content MDX files**

`apps/docs/content/index.mdx`:
```mdx
---
title: SpawnForge Documentation
---

Welcome to SpawnForge documentation.
```

`apps/docs/content/mcp/index.mdx`:
```mdx
---
title: MCP Commands
---

Browse the SpawnForge MCP command reference.
```

`apps/docs/content/api/index.mdx`:
```mdx
---
title: API Reference
---

The REST API reference is coming soon. It will be available once the API middleware ships with schema validation. In the meantime, explore the [MCP command reference](/mcp).
```

- [ ] **Step 9: Add .gitignore pattern for generated MDX**

Append to root `.gitignore`:
```gitignore
# Generated MCP command pages (regenerated on every build)
apps/docs/content/mcp/*.mdx
```

- [ ] **Step 10: Install from workspace root and verify**

```bash
cd "$(git rev-parse --show-toplevel)" && npm install
cd apps/docs && npx next build
```

Expected: Build succeeds (Fumadocs renders static pages).

- [ ] **Step 11: Commit**

```bash
git add apps/docs/ .gitignore package-lock.json
git commit -m "feat(G1): scaffold apps/docs Fumadocs site with brand styling"
```

---

## Task G2: Add `visibility` field to commands.json (batch tagging)

**Files:**
- Modify: `mcp-server/manifest/commands.json` (add `visibility` to each command)
- Create: `mcp-server/manifest/visibility-review.md` (summary for human review)
- Modify: `web/src/data/commands.json` (sync copy)

- [ ] **Step 1: Write batch tagging script**

Read `mcp-server/manifest/commands.json`, apply the heuristic table from spec Section 3.2:
- `entity:*`, `scene:*` (non-write), `query:*` → `public`
- `generation:*`, `project:*`, `admin:*`, `billing:*` → `internal`
- Default (unmatched) → `internal`

Add `"visibility": "public"` or `"visibility": "internal"` to each command object.

- [ ] **Step 2: Generate visibility-review.md**

Summary: "Tagged X commands as public, Y as internal. Review at mcp-server/manifest/visibility-review.md."

Include a table of all commands sorted by visibility for human review.

- [ ] **Step 3: Sync to web/src/data/commands.json**

Copy updated `commands.json` to `web/src/data/commands.json`.

- [ ] **Step 4: Update manifest.test.ts**

Add `visibility` to the schema validation in `mcp-server/src/manifest.test.ts`. Every command must have `visibility` as either `"public"` or `"internal"`.

- [ ] **Step 5: Run tests**

```bash
cd mcp-server && npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add mcp-server/manifest/ web/src/data/commands.json mcp-server/src/manifest.test.ts
git commit -m "feat(G2): batch-tag all 326+ commands with visibility field"
```

---

## Task G3: Build `generate-mcp-docs.ts` pipeline

**Files:**
- Create: `apps/docs/scripts/generate-mcp-docs.ts`
- Create: `apps/docs/scripts/__tests__/generate-mcp-docs.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases per spec Section 10:
1. Generates MDX for public commands only (filters internal)
2. Each generated MDX has all 4 frontmatter fields (commandName, category, visibility, description)
3. Generated body includes: description paragraph, parameters table, example JSON, category link
4. Returns `{ generatedCount, errors }` with correct count
5. Returns error for malformed manifest
6. Returns zero count when all commands are internal

- [ ] **Step 2: Implement generateMcpDocs()**

Core function signature: `generateMcpDocs(manifestPath: string, outputDir: string): { generatedCount: number, errors: string[] }`

Reads `commands.json`, filters by visibility, writes MDX files with:
- Frontmatter: commandName, category, visibility, description
- Body: description paragraph, parameters table, example JSON block, category link
- "Last updated" metadata from `git log` (per spec Section 5.1)

- [ ] **Step 3: Add author sanitization**

Per spec Section 5.1:
- HTML-escape `<`, `>`, `&`, `"` in git author names
- Check for non-printable chars (ASCII control, zero-width, BiDi overrides `\u202a-\u202e`, BOM)
- Omit author if any match
- Filter bot authors (`/bot\b/i`, `github-actions`)

- [ ] **Step 4: Run tests**

```bash
cd apps/docs && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/docs/scripts/
git commit -m "feat(G3): generate-mcp-docs.ts pipeline with visibility filtering + metadata"
```

---

## Task G4: Build CI gate scripts

**Files:**
- Create: `apps/docs/scripts/ci-gate-check.ts`
- Create: `apps/docs/scripts/check-manifest-sync.ts`
- Create: `apps/docs/scripts/__tests__/ci-gate-check.test.ts`
- Create: `apps/docs/scripts/__tests__/check-manifest-sync.test.ts`

- [ ] **Step 1: Write ci-gate-check.ts**

Per spec Section 3.4 — testable `checkGate()` function + CLI wrapper. Parses MDX frontmatter, asserts no internal command names appear.

- [ ] **Step 2: Write check-manifest-sync.ts**

Per spec Section 3.5 — testable `checkSync()` function. JSON structural comparison of `.commands` arrays.

- [ ] **Step 3: Write failing tests for both**

`checkGate()` test cases (5):
1. Returns passed when no internal commands in MDX
2. Returns failed when internal command found
3. Returns passed when content dir is empty
4. Returns failed for malformed manifest
5. Returns failed for missing/non-string commandName

`checkSync()` test cases (5):
1. Returns passed when files match
2. Returns failed when files differ
3. Returns failed when canonical missing
4. Returns failed when copy missing
5. Returns passed for whitespace/formatting differences (JSON structural)

- [ ] **Step 4: Run tests**

```bash
cd apps/docs && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add apps/docs/scripts/
git commit -m "feat(G4): CI gate scripts — internal content check + manifest sync"
```

---

## Task G5: Build faceted filtering component

**Files:**
- Create: `apps/docs/components/CommandFilter.tsx`

- [ ] **Step 1: Build accessible filter component**

Per spec Section 7.2 accessibility requirements:
- Filter groups use `role="group"` with `aria-labelledby`
- Native `<input type="checkbox">` (not custom divs)
- Tab between groups, Space toggles checkbox
- `aria-live="polite"` region: "Showing {N} commands"
- "Clear filters" button with `aria-label="Clear all filters"`
- Visible focus indicators (2px solid, accent color)

- [ ] **Step 2: Wire to MCP index page**

Integrate filter component into the MCP command index page.

- [ ] **Step 3: Commit**

```bash
git add apps/docs/components/
git commit -m "feat(G5): accessible faceted filtering for MCP command index"
```

---

## Task G6: Update CI workflows

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add `needs-docs` output to ci-gate job**

Per spec Section 12.1:
1. Add `docs` path detection: `apps/docs/**`, `mcp-server/manifest/**`
2. Add `needs-docs` output mapping
3. Modify `any_code` if-block to include `|| [ "$docs" = "true" ]`

- [ ] **Step 2: Add docs-internal-gate job**

Per spec Section 12.2:
```yaml
docs-internal-gate:
  needs: [ci-gate]
  if: ${{ needs.ci-gate.outputs.needs-docs == 'true' }}
  steps:
    - run: npm ci
    - name: Generate MCP docs
      run: cd apps/docs && npx tsx scripts/generate-mcp-docs.ts
    - name: Assert no internal commands in generated MDX
      run: npx tsx apps/docs/scripts/ci-gate-check.ts
    - name: Verify MCP manifest sync
      run: npx tsx apps/docs/scripts/check-manifest-sync.ts
```

- [ ] **Step 3: Verify CI locally**

```bash
npm ci && cd apps/docs && npx tsx scripts/generate-mcp-docs.ts && npx tsx scripts/ci-gate-check.ts && npx tsx scripts/check-manifest-sync.ts
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(G6): add docs-internal-gate job with path-based triggering"
```

---

## Task G7: Deploy to docs.spawnforge.ai

**Files:**
- Vercel project configuration (web UI)

- [ ] **Step 1: Create Vercel project**

Create `spawnforge-docs` project in Vercel, linked to the repo. Root directory: `apps/docs`. Framework: Next.js.

- [ ] **Step 2: Configure Cloudflare DNS**

DNS CNAMEs already configured: `docs.spawnforge.ai` → Vercel.

- [ ] **Step 3: Verify deployment**

```bash
curl -s https://docs.spawnforge.ai | grep "SpawnForge Documentation"
```

- [ ] **Step 4: Write E2E tests**

Per spec Section 10:
1. Landing page renders with MCP + API links
2. Category sidebar renders with alphabetical categories
3. Search for a known public command returns results
4. No internal command names appear on any page

- [ ] **Step 5: Commit**

```bash
git add apps/docs/
git commit -m "feat(G7): deploy docs.spawnforge.ai with E2E verification"
```

---

## Task G8: Update CLAUDE.md and docs

**Files:**
- Modify: `CLAUDE.md` (update Step 15 New Component Checklist)
- Modify: `README.md` (add docs.spawnforge.ai reference)

- [ ] **Step 1: Update CLAUDE.md**

Per spec Section 11, update the New Component / Command Checklist step 15 to include visibility field requirement.

- [ ] **Step 2: Update README.md**

Add `docs.spawnforge.ai` to the project URLs section.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs(G8): add docs.spawnforge.ai to CLAUDE.md checklist and README"
```

---

**Phase 1 complete.** At this point:
- `docs.spawnforge.ai` serves public MCP command reference
- 326+ commands batch-tagged with visibility
- CI gate prevents internal content leaks
- Faceted filtering with full WCAG AA accessibility
- SpawnForge brand styling (Geist Sans, Dark theme colors)
- "Last updated" metadata on all pages
- E2E tests verify deployment

---

# Phase 2: OpenAPI Reference (Depends on Plan E)

> Phase 2 tasks will be written after Plan E completes and `withApiMiddleware` has `validate` + `public` options.

**Scope:**
- OpenAPI generator from Zod schemas
- `fumadocs-openapi` interactive API pages
- Internal route exclusion
- CI gate for OpenAPI spec

---

# Phase 3: Internal Build + Polish

> Phase 3 tasks will be written after Phase 2 ships.

**Scope:**
- Internal Vercel project with Deployment Protection (SSO)
- Internal build with `INCLUDE_INTERNAL=true`
- Chromatic visual regression
- Mobile verification (44px touch targets, 320px viewport)
- Search indexing tuning
