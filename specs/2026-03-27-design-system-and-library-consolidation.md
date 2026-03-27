# SpawnForge Design System & Library Consolidation

**Spec ID:** 2026-03-27-design-system-and-library-consolidation
**Status:** Draft
**Date:** 2026-03-27

---

## 1. Overview

This spec defines the SpawnForge design system — a shared component library (`@spawnforge/ui`), a multi-theme token architecture with ambient visual effects, a public Storybook documentation site at `design.spawnforge.ai`, and the remaining backend/frontend library consolidation work required before Phase 2A.

### Goals

1. Extract reusable UI components into `@spawnforge/ui` workspace package
2. Implement 7 themes with semantic tokens and ambient effects
3. Ship a public Storybook at `design.spawnforge.ai` (tiers 1+2 public, tier 3 auth-gated)
4. Complete backend API standardization (error shapes, middleware migration, validation)
5. Complete frontend pattern standardization (Zustand selectors, dialog a11y)

### Non-Goals

- npm publishing of `@spawnforge/ui` (workspace package only)
- Theme marketplace / user-created themes (future)
- Light theme ambient effects in phase 1

---

## 2. Monorepo Structure

```
project-forge/
  packages/
    ui/                              <- @spawnforge/ui
      src/
        tokens/
          colors.ts                  <- primitive color scales
          themes.ts                  <- 7 theme definitions (semantic -> primitive maps)
          spacing.ts                 <- 4px base unit scale
          typography.ts              <- font stacks, sizes, weights
          radius.ts                  <- border-radius scale
          shadows.ts                 <- elevation shadows
          z-index.ts                 <- layered z-index scale
          effects.ts                 <- per-theme non-color overrides (radius, border-width, font)
          index.ts                   <- CSS custom property generator + re-exports
        primitives/                  <- Tier 1: Generic UI components
          Button.tsx
          Input.tsx
          Select.tsx
          Checkbox.tsx
          Modal.tsx
          Dialog.tsx
          Card.tsx
          Tabs.tsx
          Tooltip.tsx
          EmptyState.tsx
          Badge.tsx
          Spinner.tsx
          Toast.tsx
        composites/                  <- Tier 2: Domain-specific
          InspectorPanel.tsx
          TreeView.tsx
          WorkspaceLayout.tsx
          PropertyGrid.tsx
          Vec3Input.tsx
          ColorPicker.tsx
          SliderInput.tsx
          KeyboardShortcutsPanel.tsx
          SettingsPanel.tsx
        internal/                    <- Tier 3: Engine-connected (excluded from public build)
          CanvasArea.tsx
          WasmStatusIndicator.tsx
          EngineEventPanel.tsx
        effects/                     <- Ambient theme effects
          ThemeAmbient.tsx           <- Router: reads data-theme, renders correct effect
          EmberParticles.tsx         <- Floating ember particles (canvas overlay)
          IceFrost.tsx               <- Animated SVG frost cracks
          LeafParticles.tsx          <- Floating leaf particles (canvas overlay)
          RustGears.tsx              <- Micro gear rotation on dividers
          MechScanlines.tsx          <- HUD scan line sweep + corner brackets
          LightRays.tsx              <- Soft light ray effect
        hooks/
          useDialogA11y.ts
          useVirtualList.ts
          useTheme.ts                <- Read/write current theme, respects project override
        utils/
          cn.ts                      <- clsx + tailwind-merge
        index.ts                     <- Public exports (tiers 1+2, no internal/)
        internal.ts                  <- Full exports (all tiers, for main app only)
      package.json                   <- "name": "@spawnforge/ui"
      tsconfig.json

  apps/
    design/                          <- Storybook docs site
      .storybook/
        main.ts                      <- Story globs, env-gated internal/ inclusion
        preview.ts                   <- ThemeProvider decorator, dark mode default
      stories/
        primitives/                  <- Tier 1 stories
        composites/                  <- Tier 2 stories
        internal/                    <- Tier 3 stories (build-gated)
        tokens/                      <- Token reference stories (color palette, spacing, typography)
        effects/                     <- Ambient effect demos
      package.json

    web/                             <- Main SpawnForge app (existing)
      ... imports from @spawnforge/ui
```

### Package Resolution

```jsonc
// root package.json (workspace)
{
  "workspaces": ["packages/*", "apps/*", "web"]
}

// web/package.json
{
  "dependencies": {
    "@spawnforge/ui": "workspace:*"
  }
}
```

---

## 3. Design Token Architecture

### 3.1 Three-Layer Token System

| Layer | Purpose | Example |
|-------|---------|---------|
| **Primitive** | Raw values from color scales | `zinc-900`, `amber-500`, `emerald-600` |
| **Semantic** | What the value means in context | `--sf-bg-surface`, `--sf-text-muted`, `--sf-accent` |
| **Component** | Component-specific overrides (rare) | `--sf-btn-bg`, `--sf-modal-overlay` |

Components reference semantic tokens exclusively. No primitive values in component code.

### 3.2 Semantic Token Catalog

**Surfaces:**
- `--sf-bg-app` — Root application background
- `--sf-bg-surface` — Panels, cards, content areas
- `--sf-bg-elevated` — Hover states, active items, nested surfaces
- `--sf-bg-overlay` — Dropdowns, menus, popovers

**Text:**
- `--sf-text` — Primary text (headings, labels)
- `--sf-text-secondary` — Body text, descriptions
- `--sf-text-muted` — Placeholder, hints, timestamps
- `--sf-text-disabled` — Disabled controls

**Borders:**
- `--sf-border` — Default border (panels, inputs)
- `--sf-border-strong` — Active, focus, dividers

**Accents:**
- `--sf-accent` — Primary action, selection, focus ring
- `--sf-accent-hover` — Accent hover state
- `--sf-destructive` — Delete, error, danger
- `--sf-success` — Confirmation, connected, healthy
- `--sf-warning` — Caution, pending, partial

**Non-Color Tokens (theme-overridable):**
- `--sf-radius-sm` / `--sf-radius-md` / `--sf-radius-lg` / `--sf-radius-xl` / `--sf-radius-full`
- `--sf-border-width` — Default border thickness
- `--sf-font-ui` — UI font family (can shift to monospace for Mech)
- `--sf-font-mono` — Code/metrics font family
- `--sf-transition` — Default transition duration

### 3.3 Theme Definitions

7 themes. Each maps semantic tokens to primitives.

| Token | Dark | Light | Ember | Rust | Ice | Leaf | Mech |
|-------|------|-------|-------|------|-----|------|------|
| `--sf-bg-app` | zinc-950 | zinc-50 | `#1a0f05` | stone-950 | slate-950 | `#0a1a0f` | `#0c0c0e` |
| `--sf-bg-surface` | zinc-900 | white | `#2a1a0a` | stone-900 | slate-900 | `#132a1a` | `#141418` |
| `--sf-bg-elevated` | zinc-800 | zinc-100 | `#3d2814` | stone-800 | slate-800 | `#1e3d24` | `#1e1e24` |
| `--sf-accent` | blue-500 | blue-600 | amber-500 | orange-600 | cyan-400 | emerald-500 | `#00ff88` (neon green) |
| `--sf-text` | zinc-50 | zinc-900 | amber-50 | stone-50 | slate-50 | emerald-50 | `#e0e0e8` |
| `--sf-text-secondary` | zinc-400 | zinc-600 | amber-200/70 | stone-400 | slate-400 | emerald-200/70 | `#8888a0` |
| `--sf-destructive` | red-500 | red-600 | red-500 | red-600 | rose-400 | red-500 | `#ff3366` |

**Non-color overrides:**

| Token | Dark | Mech | Rust |
|-------|------|------|------|
| `--sf-radius-md` | 6px | 2px | 4px |
| `--sf-border-width` | 1px | 2px | 1px |
| `--sf-font-ui` | Geist Sans | Geist Mono | Geist Sans |

### 3.4 Theme Application

```html
<html data-theme="ember" data-effects="on">
```

```css
:root[data-theme="ember"] {
  --sf-bg-app: #1a0f05;
  --sf-bg-surface: #2a1a0a;
  --sf-accent: #f59e0b;
  /* ... all semantic tokens */
}
```

Components use only semantic references:

```tsx
<div className="bg-[var(--sf-bg-surface)] border-[var(--sf-border)] rounded-[var(--sf-radius-md)]">
```

Or with Tailwind v4 theme integration (preferred):

```tsx
<div className="bg-sf-surface border-sf-border rounded-sf-md">
```

### 3.5 Theme Persistence

- **Global default:** Stored in `localStorage` key `sf-theme` (value: `dark` | `light` | `ember` | etc.)
- **Per-project override:** Stored in project metadata (Neon DB `projects.theme` column, nullable). When set, overrides the global default for that project.
- **`useTheme()` hook** resolves: project override > global default > `dark`
- **Ambient effects toggle:** Separate `sf-effects` localStorage key (`on` | `off`). Default: `on`. Forced `off` when `prefers-reduced-motion: reduce`.

---

## 4. Ambient Theme Effects

### 4.1 Constraints

- **Canvas area is sacred.** Zero effects overlap the 3D/2D viewport.
- **`prefers-reduced-motion: reduce`** disables ALL effects. No degraded version.
- **Performance budget:** <2% CPU idle, zero layout thrash. CSS animations preferred over JS.
- **User toggle:** "Ambient effects" in Settings, independent of theme choice.
- **Pointer events:** All effect overlays are `pointer-events: none`.

### 4.2 Effect Architecture

```tsx
// ThemeAmbient.tsx — rendered in root layout, outside editor workspace
<ThemeAmbient>
  {/* Reads data-theme + data-effects attributes */}
  {/* Lazy-loads the appropriate effect component */}
  {/* Renders absolutely-positioned overlay on chrome areas only */}
</ThemeAmbient>
```

Each effect is a separate lazy-loaded module. Dark theme ships zero effect code.

### 4.3 Effects Per Theme

| Theme | Effect | Technique | Target Areas |
|-------|--------|-----------|-------------|
| **Dark** | None | — | — |
| **Light** | Soft light rays | CSS radial gradient animation | Toolbar background |
| **Ember** | Floating ember particles | Lightweight `<canvas>`, 20-30 particles | Sidebar edges, modal overlays |
| **Rust** | Micro gear rotation, grinding texture | CSS animation on SVG gears, texture overlay | Panel dividers, scrollbar tracks |
| **Ice** | Frost cracks spreading, crystalline shimmer | Animated SVG mask paths, CSS shimmer on focus rings | Panel borders, input focus, modal edges |
| **Leaf** | Floating leaf particles, vine border accents | `<canvas>` particles + CSS border-image with vine SVG | Sidebar, empty states, loading screens |
| **Mech** | Scan line sweep, HUD corner brackets | CSS gradient animation, pseudo-element brackets | Panel corners, status bar, tooltips |

---

## 5. Storybook Documentation Site

### 5.1 Hosting

- **URL:** `design.spawnforge.ai`
- **DNS:** Cloudflare CNAME record: `design` -> `cname.vercel-dns.com`
- **Hosting:** Separate Vercel project for `apps/design/`
- **Framework:** Storybook 8.x

### 5.2 Two-Build Gating

**Public build** (deployed to `design.spawnforge.ai`):
- Story globs: `stories/primitives/**`, `stories/composites/**`, `stories/tokens/**`, `stories/effects/**`
- Excludes: `stories/internal/**`

**Internal build** (deployed to `design-internal.spawnforge.ai` or Vercel preview):
- Story globs: all of the above + `stories/internal/**`
- Gated by Vercel Deployment Protection or separate domain

**Build-time gating in `.storybook/main.ts`:**

```ts
const stories = [
  '../stories/primitives/**/*.stories.@(ts|tsx)',
  '../stories/composites/**/*.stories.@(ts|tsx)',
  '../stories/tokens/**/*.stories.@(ts|tsx)',
  '../stories/effects/**/*.stories.@(ts|tsx)',
];

if (process.env.INCLUDE_INTERNAL === 'true') {
  stories.push('../stories/internal/**/*.stories.@(ts|tsx)');
}
```

**Admin list:** `AUTHORIZED_ADMINS` env var on the internal Vercel project. No hardcoded usernames.

### 5.3 Storybook Features

- **Theme toolbar:** Global decorator switches `data-theme` attribute. All stories reflect instantly.
- **Effects toggle:** Toolbar button for ambient effects on/off.
- **Auto-generated props tables:** From TypeScript interfaces.
- **Accessibility addon:** `@storybook/addon-a11y` runs axe on every story.
- **Viewport addon:** Mobile/tablet/desktop presets matching SpawnForge breakpoints.

---

## 6. Library Consolidation (Backend)

### 6.1 Error Shape Unification

**Target type:**

```ts
interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}
```

**Status code semantics:**
- 400 — Malformed request (missing fields, invalid JSON)
- 401 — Not authenticated
- 403 — Authenticated but not authorized
- 422 — Valid JSON but invalid values (business logic rejection)
- 429 — Rate limited
- 500 — Internal server error

**Helper:**

```ts
function apiError(status: number, error: string, code?: string): NextResponse {
  return NextResponse.json({ error, ...(code && { code }) }, { status });
}
```

### 6.2 withApiMiddleware Migration

~48 routes still use raw `authenticateRequest()`. Migration target: all routes use `withApiMiddleware`.

**Batches by domain:**
1. Billing routes (checkout, portal, status, usage) — 4 routes
2. Community routes (games CRUD, comments, likes, flags, tags) — 12 routes
3. Generate routes (model, texture, sfx, voice, music, sprite, tileset, skybox) — 8 routes
4. Admin routes (economics, featured, circuit-breaker) — 4 routes
5. Miscellaneous (feedback, bridges, tokens, jobs, keys, projects, publish) — ~20 routes

Each batch is a separate PR with its own review cycle.

### 6.3 Validation Unification

**Target:** All request validation through Zod schemas.

- Generation routes: already use `createGenerationHandler` with built-in Zod
- Other routes: add `validate: zodSchema` option to `withApiMiddleware`
- Chat handlers: already use `parseArgs()` with Zod

---

## 7. Library Consolidation (Frontend)

### 7.1 Zustand Selector Granularity

8 components subscribe to the full store via object destructuring. Replace with individual selectors:

```tsx
// Before (re-renders on ANY store change)
const { selectedIds, primaryId } = useEditorStore();

// After (re-renders only when these specific values change)
const selectedIds = useEditorStore(s => s.selectedIds);
const primaryId = useEditorStore(s => s.primaryId);
```

### 7.2 Dialog A11y Adoption

`useDialogA11y` hook exists and is wired into 4 modals. Remaining work:
- Scan for `fixed inset-0` without `useDialogA11y`
- Wire hook into all remaining modal/dialog components
- Cloud save indicator: add `aria-live` region

---

## 8. Phased Implementation

### Phase 1: Foundation (tokens + package + theme switcher)

- Create `packages/ui/` package structure
- Implement token system with all 7 theme definitions
- Build `cn()` utility
- Build `useTheme()` hook with global + per-project persistence
- Add theme switcher to editor Settings panel
- Migrate existing 5 UI components from `web/src/components/ui/` to package
- Wire `web/` to import from `@spawnforge/ui`
- E2E test: theme switching persists and applies

### Phase 2: Dark + Light themes (no ambient effects)

- Extract and build tier 1 primitives (Button, Input, Modal, Card, etc.)
- Ensure all primitives render correctly in both Dark and Light
- Set up Storybook in `apps/design/`
- Deploy public Storybook to `design.spawnforge.ai`
- Accessibility: all primitives pass axe in both themes

### Phase 3: Ember + Ice themes (first ambient effects)

- Implement Ember color tokens + ember particle effect
- Implement Ice color tokens + frost crack effect
- Build `ThemeAmbient` router component
- Lazy-loading for effect modules
- `prefers-reduced-motion` enforcement
- Effects toggle in Settings
- Storybook theme toolbar + effects toggle

### Phase 4: Rust + Leaf + Mech themes

- Implement remaining 3 theme color tokens
- Rust: gear micro-animation, non-color token overrides
- Leaf: leaf particles, vine border accents
- Mech: scan lines, HUD brackets, monospace font override, sharp corners
- Full E2E test coverage per theme (7 themes x assertion suite)

### Phase 5: Tier 2 composites + internal build + custom themes

- Extract domain-specific composites to package
- Build composite stories
- Set up internal Storybook build with tier 3 gating
- Deploy internal build
- Implement custom theme JSON schema validation
- Build import/export UI in Settings panel
- Custom theme resolution in `useTheme()` hook
- E2E test: import custom theme JSON, verify tokens applied

### Phase 6: Backend consolidation

- 6a: Error shape unification + `apiError()` helper
- 6b: withApiMiddleware migration (5 PR batches)
- 6c: Validation unification (Zod everywhere)

### Phase 7: Frontend consolidation

- 7a: Zustand selector granularity (8 components)
- 7b: Dialog a11y adoption (remaining modals)
- 7c: Enforcement hooks (lint rules for raw authenticateRequest, etc.)

---

## 9. Custom Themes (v1)

### 9.1 Scope

Users (or their AI tools) can create custom themes for SpawnForge. A custom theme is a **token-value-only JSON file** — no arbitrary CSS, no custom effects, no font URL injection.

### 9.2 Custom Theme Schema

```json
{
  "schemaVersion": 1,
  "name": "Cyberpunk",
  "author": "dev123",
  "description": "Neon-drenched dark theme",
  "tokens": {
    "--sf-bg-app": "#0a0014",
    "--sf-bg-surface": "#140020",
    "--sf-bg-elevated": "#1e0030",
    "--sf-bg-overlay": "#280040",
    "--sf-accent": "#ff00ff",
    "--sf-text": "#e0e0ff",
    "--sf-text-secondary": "#9090c0",
    "--sf-text-muted": "#606090",
    "--sf-border": "#2a2a4a",
    "--sf-border-strong": "#4a4a6a",
    "--sf-destructive": "#ff3366",
    "--sf-success": "#00ff88",
    "--sf-warning": "#ffaa00",
    "--sf-radius-md": "0px",
    "--sf-border-width": "2px",
    "--sf-font-ui": "inherit"
  }
}
```

### 9.3 Constraints

- **Token values only.** Only tokens from the semantic catalog (Section 3.2) are accepted. Unknown keys are silently ignored.
- **No arbitrary CSS.** Custom themes cannot inject stylesheets, `@import`, `url()`, or `content` properties.
- **No custom effects.** Ambient effects are built-in only. Custom themes inherit the nearest built-in theme's effects or none.
- **`--sf-font-ui` restricted to `inherit` or built-in fonts.** No external font URLs (prevents tracking and layout shift). Future: curated font list.
- **Validated on import.** Token values are validated against CSS value grammar (colors, lengths, font stacks). Invalid values rejected with specific error messages.

### 9.4 Versioned Token Contract

The semantic token catalog is versioned. `schemaVersion: 1` corresponds to the token set defined in Section 3.2.

- **Additive changes** (new tokens) are non-breaking — custom themes ignore unknown tokens.
- **Removing or renaming tokens** is a breaking change requiring `schemaVersion: 2`. The theme loader handles migration or warns.
- Built-in themes always use the latest schema. Custom themes declare their version.

### 9.5 Theme Resolution Order

```
custom theme (if set) > project theme override > global user default > "dark"
```

### 9.6 Import/Export

- **Export:** Settings panel "Export Theme" button downloads the JSON file.
- **Import:** Settings panel "Import Theme" accepts JSON file upload. Validated before applying.
- **Share:** Custom themes can be shared as JSON files (copy/paste, GitHub gist, etc.)
- **URL import (future):** Load theme from URL. Deferred to v2 — needs CORS and content security review.

### 9.7 Theme Editor (Future — Not in This Spec)

A visual "Theme Editor" panel where users tweak token values with live preview, color pickers, and spacing sliders. This is a significant feature and will get its own spec. The JSON import/export path ships first as the MVP.

### 9.8 AI Theme Generation (Future — Not in This Spec)

"Describe your theme" → AI generates a custom theme JSON. Requires the Theme Editor UI + AI SDK integration. Deferred.

---

## 10. DNS Setup (User Action Required)

1. **Cloudflare DNS:** Add CNAME record `design` -> `cname.vercel-dns.com`
2. **Vercel:** Create project for `apps/design/`, add `design.spawnforge.ai` as custom domain
3. **SSL:** Automatic via Vercel (Cloudflare proxy should be set to "DNS only" / grey cloud for Vercel SSL to work, or use Full (Strict) SSL mode)

---

## 10. Testing Strategy

### Per-Theme E2E Suite

Each theme gets an E2E test that verifies:
- `data-theme` attribute applied on `<html>`
- Key semantic tokens resolve to expected computed values (spot-check 5 tokens)
- No hardcoded color values leaking (grep CSS custom properties in rendered styles)
- Contrast ratios pass WCAG AA via axe-core (per theme)
- Ambient effects render when enabled, absent when disabled
- `prefers-reduced-motion` disables effects

### Component Unit Tests

Every component in `@spawnforge/ui` ships with tests covering:
- Render in all 7 themes (snapshot or visual regression)
- Accessibility (axe on isolated component)
- Prop variants (disabled, loading, error states)
- Keyboard navigation
- Ref forwarding

### Storybook Tests

- Chromatic or Percy for visual regression across themes
- Storybook test runner for interaction tests

---

## 11. Success Criteria

- [ ] `@spawnforge/ui` package builds and exports correctly
- [ ] `web/` imports all UI components from `@spawnforge/ui` (zero direct `components/ui/` imports)
- [ ] 7 themes switch correctly via Settings panel
- [ ] Theme persists globally and per-project
- [ ] Ambient effects work in Ember + Ice (Phase 3 gate)
- [ ] `design.spawnforge.ai` serves public Storybook with tiers 1+2
- [ ] Internal build includes tier 3, gated by env var
- [ ] All 48 API routes use `withApiMiddleware`
- [ ] All request validation uses Zod
- [ ] axe-core passes for all components in all 7 themes
- [ ] `prefers-reduced-motion` disables all ambient effects
- [ ] Custom theme JSON import/export works from Settings panel
- [ ] Custom theme validates token values and rejects invalid input
- [ ] Token catalog is versioned (`schemaVersion: 1`)
