# SpawnForge Design System & Library Consolidation (v2)

**Spec ID:** 2026-03-27-design-system-and-library-consolidation
**Status:** Review Round 2
**Date:** 2026-03-27
**Revision:** v2 — addresses 21 issues from 5-reviewer antagonistic sweep

---

## 1. Overview

This spec defines the SpawnForge design system — a shared component library (`@spawnforge/ui`), a multi-theme token architecture with ambient visual effects, a public Storybook documentation site at `design.spawnforge.ai`, custom theme support, and the remaining backend/frontend library consolidation work.

### Goals

1. Extract reusable UI components into `@spawnforge/ui` workspace package
2. Implement 7 themes with semantic tokens and ambient effects
3. Ship a public Storybook at `design.spawnforge.ai` (tiers 1+2 public, tier 3 in separate internal build)
4. Enable custom themes via token-value JSON import/export
5. Complete backend API standardization (error shapes, middleware migration, validation)
6. Complete frontend pattern standardization (Zustand selectors, dialog a11y)

### Non-Goals

- npm publishing of `@spawnforge/ui` (workspace-only)
- Theme marketplace / user-created themes beyond JSON import/export
- AI theme generation (future spec)
- Custom ambient effects for custom themes (built-in effects only)

---

## 2. Phase 0: Workspace Bootstrap (Prerequisite)

The project currently has no root workspace. `web/` is the sole Node project. This phase establishes the monorepo infrastructure.

### 2.1 Root Package Configuration

```jsonc
// project-forge/package.json (NEW)
{
  "name": "spawnforge",
  "private": true,
  "workspaces": ["packages/*", "apps/*", "web"],
  "engines": { "node": ">=20" }
}
```

**Package manager: npm** (matching existing `web/package-lock.json`). Dependencies reference workspace packages via `"@spawnforge/ui": "*"` (NOT `workspace:*` which is pnpm syntax).

### 2.2 Next.js Configuration

Add to `web/next.config.ts`:

```ts
transpilePackages: ['@spawnforge/ui'],
```

This resolves the import boundary — `@spawnforge/ui` lives outside `web/` but is explicitly transpiled by Next.js/Turbopack. Update CLAUDE.md: "@spawnforge/ui is the only allowed external import via transpilePackages."

### 2.3 TypeScript Configuration

```jsonc
// packages/ui/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true
  },
  "include": ["src/**/*"]
}
```

### 2.4 Package Entry Points

```jsonc
// packages/ui/package.json
{
  "name": "@spawnforge/ui",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./internal": "./src/internal.ts",
    "./tokens": "./src/tokens/index.ts",
    "./tokens/theme.css": "./src/tokens/theme.css"
  },
  "peerDependencies": { "react": "^19", "react-dom": "^19" },
  "dependencies": { "clsx": "^2", "tailwind-merge": "^3" }
}
```

### 2.5 cn() Utility

```ts
// packages/ui/src/utils/cn.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

> `clsx` and `tailwind-merge` are new dependencies.

### 2.6 CI Pipeline Updates

- `quality-gates.yml`: run `npm install` from root (workspace-aware)
- Add `packages/ui` to lint and tsc paths
- Verify existing `web/` tests still pass

### 2.7 Acceptance Criteria

- [ ] `npm install` from root resolves workspace links
- [ ] `cd web && npm run dev` starts without errors
- [ ] `import { cn } from '@spawnforge/ui'` compiles in `web/`
- [ ] All existing tests pass unchanged

---

## 3. Monorepo Structure

```
project-forge/
  package.json                       <- NEW: workspace root
  packages/
    ui/                              <- @spawnforge/ui
      src/
        tokens/
          colors.ts                  <- static hex values per theme
          themes.ts                  <- 7 theme definitions + custom theme loader
          spacing.ts, typography.ts, radius.ts, shadows.ts, z-index.ts
          theme.css                  <- Tailwind v4 @theme registration block
          index.ts                   <- CSS custom property generator + re-exports
        primitives/                  <- Tier 1 (20 components)
          Button, Input, Select, Checkbox, Switch, Slider, Modal, Dialog,
          Popover, Card, Tabs, Tooltip, EmptyState, Badge, Spinner,
          Skeleton, Toast, Alert, Separator, (+ index barrel)
        composites/                  <- Tier 2
          InspectorPanel, TreeView, WorkspaceLayout, PropertyGrid,
          Vec3Input, ColorPicker, SliderInput, KeyboardShortcutsPanel,
          SettingsPanel
        internal/                    <- Tier 3 (excluded from public build)
          CanvasArea, WasmStatusIndicator, EngineEventPanel
        effects/                     <- Ambient effects (ALL CSS-only, NO canvas)
          ThemeAmbient, EmberGlow, IceFrost, LeafDrift, RustGears,
          MechScanlines, LightRays
        hooks/
          useDialogA11y, useVirtualList, useTheme
        utils/
          cn.ts, themeValidator.ts
        index.ts                     <- Public exports (tiers 1+2)
        internal.ts                  <- Full exports (all tiers)
  apps/
    design/                          <- Storybook docs site
  web/                               <- Main app (existing)
```

---

## 4. Design Token Architecture

### 4.1 Three-Layer System

| Layer | Purpose | Example |
|-------|---------|---------|
| **Primitive** | Raw hex/length values | `#18181b`, `6px` |
| **Semantic** | What the value means | `--sf-bg-surface`, `--sf-accent` |
| **Component** | Component-specific override (rare) | `--sf-btn-bg` |

Components reference semantic tokens exclusively.

### 4.2 Semantic Token Catalog (v1 — versioned contract)

All values are **static hex colors or literal CSS values**. No Tailwind opacity shorthand, no `color-mix()`. Opacity is pre-computed to final hex per theme.

**Surfaces:** `--sf-bg-app`, `--sf-bg-surface`, `--sf-bg-elevated`, `--sf-bg-overlay`
**Text:** `--sf-text`, `--sf-text-secondary`, `--sf-text-muted`, `--sf-text-disabled`
**Borders:** `--sf-border`, `--sf-border-strong`
**Accents:** `--sf-accent`, `--sf-accent-hover`, `--sf-destructive`, `--sf-success`, `--sf-warning`
**Non-Color:** `--sf-radius-sm/md/lg/xl/full`, `--sf-border-width`, `--sf-font-ui`, `--sf-font-mono`, `--sf-transition`

### 4.3 Theme Definitions (all hex, WCAG AA verified)

| Token | Dark | Light | Ember | Rust | Ice | Leaf | Mech |
|-------|------|-------|-------|------|-----|------|------|
| `--sf-bg-app` | `#09090b` | `#fafafa` | `#1a0f05` | `#1c1917` | `#0f172a` | `#0a1a0f` | `#0c0c0e` |
| `--sf-bg-surface` | `#18181b` | `#ffffff` | `#2a1a0a` | `#292524` | `#1e293b` | `#132a1a` | `#141418` |
| `--sf-bg-elevated` | `#27272a` | `#f4f4f5` | `#3d2814` | `#44403c` | `#334155` | `#1e3d24` | `#1e1e24` |
| `--sf-bg-overlay` | `#3f3f46` | `#e4e4e7` | `#4d3520` | `#57534e` | `#475569` | `#2d5438` | `#28283a` |
| `--sf-text` | `#fafafa` | `#18181b` | `#fef3c7` | `#fafaf9` | `#f1f5f9` | `#ecfdf5` | `#e0e0e8` |
| `--sf-text-secondary` | `#a1a1aa` | `#52525b` | `#d4a574` | `#a8a29e` | `#94a3b8` | `#6ee7a0` | `#8888a0` |
| `--sf-text-muted` | `#71717a` | `#a1a1aa` | `#9a7a52` | `#78716c` | `#64748b` | `#4aba6e` | `#606078` |
| `--sf-text-disabled` | `#52525b` | `#d4d4d8` | `#6b5030` | `#57534e` | `#475569` | `#2d7a42` | `#404058` |
| `--sf-border` | `#27272a` | `#e4e4e7` | `#3d2814` | `#44403c` | `#334155` | `#1e3d24` | `#1e1e30` |
| `--sf-border-strong` | `#3f3f46` | `#a1a1aa` | `#5c3d1e` | `#57534e` | `#475569` | `#2d5438` | `#2e2e48` |
| `--sf-accent` | `#3b82f6` | `#2563eb` | `#f59e0b` | `#ea580c` | `#22d3ee` | `#10b981` | `#00ff88` |
| `--sf-destructive` | `#ef4444` | `#dc2626` | `#ef4444` | `#dc2626` | `#fb7185` | `#ef4444` | `#ff3366` |

**Non-color overrides (ALL 7 themes):**

| Token | Dark | Light | Ember | Rust | Ice | Leaf | Mech |
|-------|------|-------|-------|------|-----|------|------|
| `--sf-radius-md` | 6px | 6px | 8px | 4px | 2px | 10px | 1px |
| `--sf-border-width` | 1px | 1px | 1px | 2px | 1px | 1px | 2px |
| `--sf-font-ui` | Geist Sans | Geist Sans | Geist Sans | Geist Sans | Geist Sans | Geist Sans | Geist Mono |
| `--sf-transition` | 150ms | 150ms | 200ms | 100ms | 120ms | 180ms | 80ms |

> Ice = crystalline 2px corners. Leaf = organic 10px. Mech = tactical 1px + monospace + 2px borders. Rust = industrial 4px + heavy 2px borders. Ember = warm 8px + slow transitions. These non-color overrides ensure themes are visually distinct even without effects.

### 4.4 Tailwind v4 @theme Integration

```css
/* packages/ui/src/tokens/theme.css — imported by consumers */
@theme {
  --color-sf-bg-app: var(--sf-bg-app);
  --color-sf-bg-surface: var(--sf-bg-surface);
  --color-sf-bg-elevated: var(--sf-bg-elevated);
  --color-sf-bg-overlay: var(--sf-bg-overlay);
  --color-sf-text: var(--sf-text);
  --color-sf-text-secondary: var(--sf-text-secondary);
  --color-sf-text-muted: var(--sf-text-muted);
  --color-sf-border: var(--sf-border);
  --color-sf-border-strong: var(--sf-border-strong);
  --color-sf-accent: var(--sf-accent);
  --color-sf-destructive: var(--sf-destructive);
  --color-sf-success: var(--sf-success);
  --color-sf-warning: var(--sf-warning);
}
```

Usage: `@import '@spawnforge/ui/tokens/theme.css';` in `globals.css`.

Enables: `bg-sf-bg-surface`, `text-sf-text`, `border-sf-border` as Tailwind utilities. Fallback `bg-[var(--sf-bg-surface)]` always works if `@theme` is not loaded.

### 4.5 Theme Application

```html
<html data-sf-theme="ember" data-sf-effects="on">
```

Prefix `data-sf-*` avoids collision with third-party `data-theme` attributes.

### 4.6 Theme Persistence & Resolution

```
useTheme() resolution: custom theme > project override > global default > "dark"
```

- **Global:** `sf-theme` in localStorage. **Validated on read** against `['dark','light','ember','rust','ice','leaf','mech']`. Invalid values fall back to `'dark'`.
- **Per-project:** Neon DB `projects.theme` column (TEXT, nullable). Migration in Phase 0.
- **Custom themes:** UUID in `sf-custom-theme-id`. Data in IndexedDB.
- **Effects:** `sf-effects` in localStorage (`on`|`off`). Forced `off` when `prefers-reduced-motion: reduce`.

### 4.7 CSS Variable Migration (Incremental)

`globals.css` has `--background`, `--foreground`, `--surface`, `--border`, `--muted`. The `--sf-` prefix avoids collision. Old vars remain until all consumers are migrated (Phase 7).

### 4.8 Font Strategy

Self-hosted via `geist` npm package + `next/font/local`. No external CDN. Required weights: 400, 500, 600.

Font allowlist for custom themes: `inherit`, `'Geist Sans', system-ui, sans-serif`, `'Geist Mono', ui-monospace, monospace`, `system-ui, sans-serif`, `ui-monospace, monospace`. No `url()` or external references.

---

## 5. Ambient Theme Effects (CSS-Only)

### 5.1 Architecture

**All effects are CSS-only.** No `<canvas>`, no `requestAnimationFrame`, no JS particle systems. This eliminates CPU contention with the WASM engine, memory leaks on theme switch, and canvas test assertion problems.

Effects use: CSS animations, SVG `<animate>`, CSS gradients, `border-image`, pseudo-elements, `@keyframes`.

### 5.2 Constraints

- **Viewport is sacred.** Effects only on chrome. Never on the canvas.
- **`prefers-reduced-motion: reduce`** → `ThemeAmbient` renders null.
- **User toggle:** Settings → "Ambient effects: On/Off"
- **Z-index:** `ThemeAmbient` at `--sf-z-effects` (5), below panels (10), modals (50), tooltips (60), toasts (70).
- **DOM placement:** Sibling of editor workspace. `position: fixed` with exclusion for canvas bounding rect. `pointer-events: none`.
- **Cleanup:** Pure CSS — React unmount removes DOM, animations stop.

### 5.3 Effects Per Theme

| Theme | Effect | CSS Technique |
|-------|--------|---------------|
| Dark | None | — |
| Light | Soft radial glow | CSS `radial-gradient` animation |
| Ember | Glowing edge pulse + SVG sparks | CSS `box-shadow` animation + SVG `<animate>` |
| Rust | Micro gear rotation | CSS `rotate` on inline SVG |
| Ice | Frost crack paths + shimmer | SVG `stroke-dashoffset` animation + CSS shimmer |
| Leaf | SVG leaf drift + vine border | CSS `translate` animation + SVG `border-image` |
| Mech | Scan line sweep + HUD brackets | CSS `linear-gradient` animation + pseudo-elements |

### 5.4 Testing

**Visual regression (Chromatic) is MANDATORY.** One snapshot per theme (effects on + off) = 14 baselines.

- **Playwright:** Assert `[data-sf-effect]` element exists, `animationName !== 'none'`, `pointer-events: none`, z-index matches.
- **Reduced motion (Playwright):** `page.emulateMedia({ reducedMotion: 'reduce' })` → effect container not rendered.
- **Reduced motion (vitest):** `vi.spyOn(window, 'matchMedia')` → `ThemeAmbient` returns null.
- **Performance:** CSS-only eliminates CPU profiling need. Lighthouse score must not drop >3 points with effects on.

---

## 6. Custom Themes (v1)

### 6.1 Schema

```json
{
  "schemaVersion": 1,
  "name": "Cyberpunk",
  "author": "dev123",
  "description": "Neon-drenched dark theme",
  "tokens": {
    "--sf-bg-app": "#0a0014",
    "--sf-accent": "#ff00ff",
    "--sf-font-ui": "inherit"
  }
}
```

### 6.2 Validators (Concrete, Per-Category)

- **Colors:** `/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/` (hex only). Extends existing `validateCssColor()` pattern.
- **Lengths:** `/^\d+(\.\d+)?(px|rem)$/`
- **Fonts:** Exact allowlist (Section 4.8). No free-text.
- **Durations:** `/^\d+(ms|s)$/`
- **Metadata:** `name`/`author` max 64 chars, `description` max 256. Rendered via React default escaping only.
- **File size:** 50KB max.
- **`schemaVersion`:** Required, positive integer. Missing/invalid → reject.
- **Unknown keys:** Silently dropped (NOT passed to CSS).
- **Partial themes:** Missing tokens inherit from Dark.

### 6.3 Versioned Contract

v1 = Section 4.2 catalog. Additive = non-breaking. Rename/remove = v2 with migration table. Future version on old loader → "Requires newer SpawnForge."

### 6.4 Required Negative Test Cases

| Input | Expected |
|-------|----------|
| `{ "tokens": {} }` | Accepted (inherits Dark) |
| Missing `schemaVersion` | Rejected |
| `schemaVersion: 0` / `-1` / `"latest"` | Rejected |
| `schemaVersion: 2` (future) | Rejected ("requires newer version") |
| `"--sf-accent": "red; --x: url(evil)"` | Rejected (fails hex regex) |
| `"--sf-accent": "url(javascript:alert(1))"` | Rejected |
| `"--sf-accent": null` | Rejected (not string) |
| `"--sf-font-ui": "Comic Sans"` | Rejected (not in allowlist) |
| `"--sf-font-mono": "'x', url(//evil)"` | Rejected |
| Unknown key `--sf-custom-foo` | Dropped |
| 60KB JSON | Rejected (>50KB) |
| `name` 200 chars | Rejected (>64) |

### 6.5 UX

- Import dialog includes inline example JSON + link to docs.
- Validation errors shown as specific toasts ("Token --sf-accent: must be hex like #ff00ff").
- No URL import in v1 (deferred, requires server-side proxy + CSP).

---

## 7. Storybook Documentation Site

### 7.1 Hosting

- URL: `design.spawnforge.ai` (Cloudflare CNAME `design` → `cname.vercel-dns.com`, grey cloud)
- Vercel project root: `apps/design`, build: `npx storybook build`, output: `storybook-static`
- Storybook 8.6+

### 7.2 Two-Build Gating

Public build excludes `stories/internal/**`. Internal build includes all. **Vercel Deployment Protection on internal project is MANDATORY.** Build-time exclusion is defense-in-depth, not the access control.

### 7.3 Local Dev

```bash
cd apps/design && npm run storybook          # public stories
INCLUDE_INTERNAL=true npm run storybook      # all stories
```

### 7.4 Storybook vs Vitest Responsibility

| Concern | Tool |
|---------|------|
| Renders, props, keyboard | Vitest |
| Theme correctness | Vitest (parameterized) |
| Visual regression | Chromatic (mandatory) |
| Interaction demos | Storybook (not a CI gate) |
| Accessibility | Both (vitest unit + Storybook addon) |

---

## 8. Theme Switching UX

- **Location:** Settings → Appearance
- **Layout:** Visual swatch grid (7 cards with name + accent swatch + mini preview)
- **Live preview:** Instant on click (no Apply button). Selecting different swatch switches immediately.
- **Per-project:** "Use different theme for this project" checkbox below grid. Saves to DB.
- **Effects toggle:** Switch below themes: "Ambient effects: On/Off"
- **Custom theme:** "Import Custom Theme" button with file picker + inline docs
- **Transition:** 200ms CSS transition on `--sf-*` properties. 0ms if `prefers-reduced-motion`.

---

## 9. Migration Strategy

### 9.1 Scope

~2,766 hardcoded zinc/stone/slate class usages across ~134 files. NOT done in Phase 1.

### 9.2 Approach

**Phase 1:** Token system ships. New components use tokens. Old components unchanged.

**Phase 7:** Codemod + lint rule:
- `npx sf-migrate-tokens <file>` replaces `bg-zinc-900` → `bg-sf-bg-surface`, etc.
- Lint rule `no-hardcoded-primitives`: warns on `zinc-*` in migrated files, errors in new files.
- Migration batched by directory, one PR each.

### 9.3 DB Migration (Phase 0)

```sql
ALTER TABLE projects ADD COLUMN theme TEXT;
```

Generated via `npm run db:generate`, deployed via `npx drizzle-kit push --force`.

---

## 10. Testing Strategy

### 10.1 Per-Theme E2E (Prescribed Minimum)

For each of 7 themes, verify computed values of: `--sf-bg-app`, `--sf-accent`, `--sf-text`, `--sf-destructive`, `--sf-radius-md`, `--sf-border-width`.

Additional: mid-session switch, rapid switching (10x in 2s), invalid `sf-theme` → fallback, per-project override priority.

### 10.2 Component Unit Tests

Parameterized `it.each(THEMES)`: no runtime error, no hardcoded primitives leak, ARIA correct. **No snapshots.**

### 10.3 Reduced Motion

Vitest: `vi.spyOn(window, 'matchMedia')` mock. Playwright: `page.emulateMedia({ reducedMotion: 'reduce' })`.

### 10.4 Custom Theme Validation

All cases from Section 6.4 as unit tests in `themeValidator.test.ts`.

### 10.5 Token Backward Compatibility

v1 theme after v2 additions, renamed token fallback, future version rejection, invalid schemaVersion.

### 10.6 Visual Regression (Chromatic — Mandatory)

7 themes x effects on/off = 14 baselines minimum. CI gate. Baseline update requires PR approval.

### 10.7 Performance

CSS-only effects → no CPU profiling. Lighthouse gate: score must not drop >3 points with effects on.

---

## 11. Contributing a New Component

1. Decide tier (primitive/composite/internal)
2. Create in `packages/ui/src/{tier}/`
3. Use tokens: `cn('bg-sf-bg-surface text-sf-text')`
4. Export in `index.ts` (tiers 1+2) or `internal.ts` (tier 3)
5. Tests: parameterized 7 themes, axe, keyboard, all prop variants
6. Story in `apps/design/stories/{tier}/`
7. Validate: vitest + `build-storybook`

---

## 12. Backend Consolidation

- **12.1:** `ApiErrorResponse` type + `apiError()` helper
- **12.2:** withApiMiddleware migration (~48 routes, 5 PR batches)
- **12.3:** Zod validation everywhere

---

## 13. Frontend Consolidation

- **13.1:** Zustand selector granularity (8 components)
- **13.2:** Dialog a11y adoption (remaining modals)
- **13.3:** Enforcement hooks (lint rules)

---

## 14. DNS Setup (User Action)

1. Cloudflare CNAME `design` → `cname.vercel-dns.com` (grey cloud)
2. Vercel project for `apps/design/`, domain `design.spawnforge.ai`
3. SSL automatic via Vercel

---

## 15. Phased Implementation

| Phase | Scope |
|-------|-------|
| **0** | Workspace bootstrap, `cn()`, root package.json, transpilePackages, DB migration |
| **1** | Token system, 7 theme definitions, `@theme` CSS, `useTheme()`, theme switcher UI |
| **2** | 20 tier 1 primitives, Dark+Light verified, Storybook deployed, Chromatic connected |
| **3** | Ember+Ice colors+effects, `ThemeAmbient`, reduced-motion, effects toggle |
| **4** | Rust+Leaf+Mech colors+effects, full 7-theme E2E suite |
| **5** | Tier 2 composites, custom theme import/export, internal Storybook build |
| **6** | Backend consolidation (error shapes, middleware, Zod) |
| **7** | Frontend consolidation, codemod tool, lint rules, incremental migration |

---

## 16. Success Criteria

- [ ] Workspace root resolves all packages
- [ ] `@spawnforge/ui` builds and exports
- [ ] 7 themes switch via Settings swatch grid with 200ms transition
- [ ] Theme persists globally + per-project (DB column)
- [ ] CSS-only ambient effects work, `prefers-reduced-motion` kills them
- [ ] `design.spawnforge.ai` serves public Storybook
- [ ] Internal build has Vercel Deployment Protection
- [ ] Custom theme import validates all inputs (full negative suite)
- [ ] Token catalog versioned with backward-compat tests
- [ ] axe-core passes all components in all 7 themes
- [ ] Chromatic baselines for all themes
- [ ] No hardcoded `zinc-*` in `@spawnforge/ui`
- [ ] Codemod tool exists for legacy migration (Phase 7)
