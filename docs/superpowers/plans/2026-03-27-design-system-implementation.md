# SpawnForge Design System — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@spawnforge/ui` — a shared component library with 7 themes, ambient effects, Storybook docs, custom theme support, and complete backend/frontend consolidation.

**Architecture:** npm workspace monorepo with `packages/ui` (shared library), `apps/design` (Storybook), and `web` (existing app). Semantic CSS custom properties switched at runtime via `data-sf-theme` attribute. CSS-only ambient effects. Tailwind v4 `@utility` shortcuts for verbosity reduction.

**Tech Stack:** React 19, Next.js 16, Tailwind v4, Storybook 8.6, Chromatic, clsx + tailwind-merge, Drizzle ORM, Vitest, Playwright.

**Spec:** `specs/2026-03-27-design-system-and-library-consolidation.md` (v3-final, 5-reviewer approved)

---

## Cross-Plan Dependency Map

```
Plan A (Foundation) ──► Plan B (Primitives + Storybook)
                    ──► Plan C (Effects) requires Plan B Storybook
                    ──► Plan D (Custom Themes) requires Plan B primitives
                    ──► Plan E (Backend) independent after Plan A
                    ──► Plan F (Frontend) independent after Plan A

Plan B ──► Plan C (effects need Storybook for Chromatic)
Plan B ──► Plan D (custom themes need SettingsPanel composite)
Plan C ──► Plan D (custom themes inherit from themes defined in C)
```

Plans E and F are independent of B/C/D and can run in parallel.

---

# Plan A: Foundation (Phases 0-1)

**What ships:** Workspace monorepo, `@spawnforge/ui` package skeleton, token system with all 7 theme definitions, `useTheme()` hook, theme switcher in Settings, DB migration.

**Prerequisite for:** Everything else.

---

### Task A1: Create workspace root package.json

**Files:**
- Create: `package.json` (project root)
- Modify: `.gitignore` (add `web/package-lock.json`)

- [ ] **Step 1: Write the root package.json**

```json
{
  "name": "spawnforge",
  "private": true,
  "workspaces": ["packages/*", "apps/*", "web"],
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 2: Add web/package-lock.json to .gitignore**

Append to `.gitignore`:
```
web/package-lock.json
```

- [ ] **Step 3: Run npm install from root**

```bash
npm install
```

Expected: Creates root `node_modules/` with workspace symlinks. Root `package-lock.json` generated.

- [ ] **Step 4: Delete old web lockfile**

```bash
rm web/package-lock.json
```

- [ ] **Step 5: Verify web still works**

```bash
cd web && npm run dev
```

Expected: Dev server starts. Visit `http://localhost:3000/dev` — editor loads.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore package-lock.json
git commit -m "feat: add workspace root package.json for monorepo"
```

---

### Task A2: Create @spawnforge/ui package skeleton

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/utils/cn.ts`
- Create: `packages/ui/src/index.ts`
- Create: `packages/ui/src/internal.ts`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p packages/ui/src/{tokens,primitives,composites,internal,effects,hooks,utils}
mkdir -p packages/ui/src/primitives/__tests__
mkdir -p packages/ui/src/utils/__tests__
```

- [ ] **Step 2: Write packages/ui/package.json**

```json
{
  "name": "@spawnforge/ui",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./internal": { "types": "./dist/internal.d.ts", "default": "./dist/internal.js" },
    "./tokens": { "types": "./dist/tokens/index.d.ts", "default": "./dist/tokens/index.js" },
    "./tokens/theme.css": "./src/tokens/theme.css"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "peerDependencies": {
    "react": "^19",
    "react-dom": "^19"
  },
  "dependencies": {
    "clsx": "^2",
    "tailwind-merge": "^3"
  },
  "devDependencies": {
    "vitest": "^4",
    "@testing-library/react": "^16",
    "@testing-library/jest-dom": "^6",
    "jsdom": "^29",
    "typescript": "^6",
    "@types/react": "^19",
    "@types/react-dom": "^19"
  }
}
```

- [ ] **Step 3: Write packages/ui/tsconfig.json**

```json
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
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.*", "dist"]
}
```

- [ ] **Step 4: Write cn() utility**

```ts
// packages/ui/src/utils/cn.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: Write failing test for cn()**

```ts
// packages/ui/src/utils/__tests__/cn.test.ts
import { describe, it, expect } from 'vitest';
import { cn } from '../cn';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible');
  });

  it('deduplicates tailwind utilities', () => {
    expect(cn('p-4', 'p-8')).toBe('p-8');
  });

  it('handles undefined and null', () => {
    expect(cn('base', undefined, null, 'end')).toBe('base end');
  });
});
```

- [ ] **Step 6: Write vitest config**

```ts
// packages/ui/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
  },
});
```

- [ ] **Step 7: Run test to verify it passes**

```bash
cd packages/ui && npx vitest run
```

Expected: 4 tests pass.

- [ ] **Step 8: Write barrel exports**

```ts
// packages/ui/src/index.ts
// Public exports (tiers 1 + 2)
export { cn } from './utils/cn';
```

```ts
// packages/ui/src/internal.ts
// Full exports (all tiers, including engine-connected)
export * from './index';
```

- [ ] **Step 9: Build the package**

```bash
cd packages/ui && npm run build
```

Expected: `dist/` directory created with `.js` and `.d.ts` files.

- [ ] **Step 10: Commit**

```bash
git add packages/ui/
git commit -m "feat: @spawnforge/ui package skeleton with cn() utility"
```

---

### Task A3: Wire @spawnforge/ui into web/

**Files:**
- Modify: `web/next.config.ts` (add transpilePackages)
- Modify: `web/package.json` (add workspace dependency)
- Modify: `CLAUDE.md` (document import boundary exception)

- [ ] **Step 1: Add workspace dependency to web/package.json**

Add to `dependencies`:
```json
"@spawnforge/ui": "*"
```

- [ ] **Step 2: Add transpilePackages to next.config.ts**

In `web/next.config.ts`, add to the `nextConfig` object (before the `compress` key):

```ts
transpilePackages: ['@spawnforge/ui'],
```

The full object becomes:
```ts
const nextConfig: NextConfig = {
  transpilePackages: ['@spawnforge/ui'],
  compress: false,
  // ... rest of existing config
};
```

- [ ] **Step 3: Run npm install from root to link workspace**

```bash
cd /path/to/project-forge && npm install
```

- [ ] **Step 4: Verify import works**

Create a temporary test file:
```ts
// web/src/lib/__test_import.ts (temporary — delete after verification)
import { cn } from '@spawnforge/ui';
console.log(cn('test', 'classes'));
```

```bash
cd web && npx tsc --noEmit
```

Expected: No type errors.

Delete the test file after verification.

- [ ] **Step 5: Update CLAUDE.md**

Add to the "Key Architecture Rules" section:
```
- **Import boundary exception**: `@spawnforge/ui` is the only allowed external import via `transpilePackages` in `next.config.ts`. All other imports must be within `web/`.
```

- [ ] **Step 6: Verify dev server**

```bash
cd web && npm run dev
```

Expected: Dev server starts without errors.

- [ ] **Step 7: Commit**

```bash
git add web/next.config.ts web/package.json CLAUDE.md package-lock.json
git commit -m "feat: wire @spawnforge/ui into web/ via transpilePackages"
```

---

### Task A4: Update CI for workspace root

**Files:**
- Modify: `.github/workflows/quality-gates.yml`

- [ ] **Step 1: Update all npm ci steps**

In `quality-gates.yml`, for EVERY job that has:
```yaml
- run: npm ci
  working-directory: web
```
with:
```yaml
cache-dependency-path: web/package-lock.json
```

Change to:
```yaml
- run: npm ci
  # Runs from workspace root
```
with:
```yaml
cache-dependency-path: package-lock.json
```

Remove `working-directory: web` from `npm ci` steps. Keep `working-directory: web` on steps that run `npx eslint`, `npx tsc`, `npx vitest` etc. (those still need to run from web/).

Also add a `packages/ui` build step before web tests:
```yaml
- name: Build @spawnforge/ui
  run: cd packages/ui && npm run build
```

- [ ] **Step 2: Add packages/ui test step**

After the ui build step:
```yaml
- name: Test @spawnforge/ui
  run: cd packages/ui && npx vitest run
```

- [ ] **Step 3: Verify CI passes locally**

```bash
npm ci && cd packages/ui && npm run build && npx vitest run && cd ../web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run
```

Expected: All steps pass.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/quality-gates.yml
git commit -m "ci: update quality gates for workspace root + @spawnforge/ui build/test"
```

---

### Task A5: Design token definitions (all 7 themes)

**Files:**
- Create: `packages/ui/src/tokens/colors.ts`
- Create: `packages/ui/src/tokens/themes.ts`
- Create: `packages/ui/src/tokens/spacing.ts`
- Create: `packages/ui/src/tokens/typography.ts`
- Create: `packages/ui/src/tokens/radius.ts`
- Create: `packages/ui/src/tokens/z-index.ts`
- Create: `packages/ui/src/tokens/index.ts`
- Create: `packages/ui/src/tokens/theme.css`
- Test: `packages/ui/src/tokens/__tests__/themes.test.ts`

- [ ] **Step 1: Write the theme type definitions**

```ts
// packages/ui/src/tokens/colors.ts

export const THEME_NAMES = ['dark', 'light', 'ember', 'rust', 'ice', 'leaf', 'mech'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

/** All semantic color tokens. Values are static hex strings (WCAG AA verified). */
export interface ThemeColorTokens {
  '--sf-bg-app': string;
  '--sf-bg-surface': string;
  '--sf-bg-elevated': string;
  '--sf-bg-overlay': string;
  '--sf-text': string;
  '--sf-text-secondary': string;
  '--sf-text-muted': string;
  '--sf-text-disabled': string;
  '--sf-border': string;
  '--sf-border-strong': string;
  '--sf-accent': string;
  '--sf-accent-hover': string;
  '--sf-destructive': string;
  '--sf-success': string;
  '--sf-warning': string;
}

/** Non-color tokens that vary per theme */
export interface ThemeStructureTokens {
  '--sf-radius-sm': string;
  '--sf-radius-md': string;
  '--sf-radius-lg': string;
  '--sf-radius-xl': string;
  '--sf-radius-full': string;
  '--sf-border-width': string;
  '--sf-font-ui': string;
  '--sf-font-mono': string;
  '--sf-transition': string;
}

export type ThemeTokens = ThemeColorTokens & ThemeStructureTokens;
```

- [ ] **Step 2: Write all 7 theme definitions**

```ts
// packages/ui/src/tokens/themes.ts
import type { ThemeName, ThemeTokens } from './colors';

const BASE_STRUCTURE: Pick<ThemeTokens, '--sf-radius-sm' | '--sf-radius-full' | '--sf-font-mono'> = {
  '--sf-radius-sm': '4px',
  '--sf-radius-full': '9999px',
  '--sf-font-mono': "'Geist Mono', ui-monospace, monospace",
};

export const THEME_DEFINITIONS: Record<ThemeName, ThemeTokens> = {
  dark: {
    ...BASE_STRUCTURE,
    '--sf-bg-app': '#09090b',
    '--sf-bg-surface': '#18181b',
    '--sf-bg-elevated': '#27272a',
    '--sf-bg-overlay': '#3f3f46',
    '--sf-text': '#fafafa',
    '--sf-text-secondary': '#a1a1aa',
    '--sf-text-muted': '#71717a',
    '--sf-text-disabled': '#52525b',
    '--sf-border': '#27272a',
    '--sf-border-strong': '#3f3f46',
    '--sf-accent': '#3b82f6',
    '--sf-accent-hover': '#2563eb',
    '--sf-destructive': '#ef4444',
    '--sf-success': '#22c55e',
    '--sf-warning': '#eab308',
    '--sf-radius-md': '6px',
    '--sf-radius-lg': '8px',
    '--sf-radius-xl': '12px',
    '--sf-border-width': '1px',
    '--sf-font-ui': "'Geist Sans', system-ui, sans-serif",
    '--sf-transition': '150ms',
  },
  light: {
    ...BASE_STRUCTURE,
    '--sf-bg-app': '#fafafa',
    '--sf-bg-surface': '#ffffff',
    '--sf-bg-elevated': '#f4f4f5',
    '--sf-bg-overlay': '#e4e4e7',
    '--sf-text': '#18181b',
    '--sf-text-secondary': '#52525b',
    '--sf-text-muted': '#a1a1aa',
    '--sf-text-disabled': '#d4d4d8',
    '--sf-border': '#e4e4e7',
    '--sf-border-strong': '#a1a1aa',
    '--sf-accent': '#2563eb',
    '--sf-accent-hover': '#1d4ed8',
    '--sf-destructive': '#dc2626',
    '--sf-success': '#16a34a',
    '--sf-warning': '#ca8a04',
    '--sf-radius-md': '6px',
    '--sf-radius-lg': '8px',
    '--sf-radius-xl': '12px',
    '--sf-border-width': '1px',
    '--sf-font-ui': "'Geist Sans', system-ui, sans-serif",
    '--sf-transition': '150ms',
  },
  ember: {
    ...BASE_STRUCTURE,
    '--sf-bg-app': '#1a0f05',
    '--sf-bg-surface': '#2a1a0a',
    '--sf-bg-elevated': '#3d2814',
    '--sf-bg-overlay': '#4d3520',
    '--sf-text': '#fef3c7',
    '--sf-text-secondary': '#d4a574',
    '--sf-text-muted': '#9a7a52',
    '--sf-text-disabled': '#6b5030',
    '--sf-border': '#3d2814',
    '--sf-border-strong': '#5c3d1e',
    '--sf-accent': '#f59e0b',
    '--sf-accent-hover': '#d97706',
    '--sf-destructive': '#ef4444',
    '--sf-success': '#22c55e',
    '--sf-warning': '#f59e0b',
    '--sf-radius-md': '8px',
    '--sf-radius-lg': '10px',
    '--sf-radius-xl': '14px',
    '--sf-border-width': '1px',
    '--sf-font-ui': "'Geist Sans', system-ui, sans-serif",
    '--sf-transition': '200ms',
  },
  rust: {
    ...BASE_STRUCTURE,
    '--sf-bg-app': '#1c1917',
    '--sf-bg-surface': '#292524',
    '--sf-bg-elevated': '#44403c',
    '--sf-bg-overlay': '#57534e',
    '--sf-text': '#fafaf9',
    '--sf-text-secondary': '#a8a29e',
    '--sf-text-muted': '#78716c',
    '--sf-text-disabled': '#57534e',
    '--sf-border': '#44403c',
    '--sf-border-strong': '#57534e',
    '--sf-accent': '#ea580c',
    '--sf-accent-hover': '#c2410c',
    '--sf-destructive': '#dc2626',
    '--sf-success': '#16a34a',
    '--sf-warning': '#ca8a04',
    '--sf-radius-md': '4px',
    '--sf-radius-lg': '6px',
    '--sf-radius-xl': '8px',
    '--sf-border-width': '2px',
    '--sf-font-ui': "'Geist Sans', system-ui, sans-serif",
    '--sf-transition': '100ms',
  },
  ice: {
    ...BASE_STRUCTURE,
    '--sf-bg-app': '#0f172a',
    '--sf-bg-surface': '#1e293b',
    '--sf-bg-elevated': '#334155',
    '--sf-bg-overlay': '#475569',
    '--sf-text': '#f1f5f9',
    '--sf-text-secondary': '#94a3b8',
    '--sf-text-muted': '#64748b',
    '--sf-text-disabled': '#475569',
    '--sf-border': '#334155',
    '--sf-border-strong': '#475569',
    '--sf-accent': '#22d3ee',
    '--sf-accent-hover': '#06b6d4',
    '--sf-destructive': '#fb7185',
    '--sf-success': '#34d399',
    '--sf-warning': '#fbbf24',
    '--sf-radius-md': '2px',
    '--sf-radius-lg': '4px',
    '--sf-radius-xl': '6px',
    '--sf-border-width': '1px',
    '--sf-font-ui': "'Geist Sans', system-ui, sans-serif",
    '--sf-transition': '120ms',
  },
  leaf: {
    ...BASE_STRUCTURE,
    '--sf-bg-app': '#0a1a0f',
    '--sf-bg-surface': '#132a1a',
    '--sf-bg-elevated': '#1e3d24',
    '--sf-bg-overlay': '#2d5438',
    '--sf-text': '#ecfdf5',
    '--sf-text-secondary': '#6ee7a0',
    '--sf-text-muted': '#4aba6e',
    '--sf-text-disabled': '#2d7a42',
    '--sf-border': '#1e3d24',
    '--sf-border-strong': '#2d5438',
    '--sf-accent': '#10b981',
    '--sf-accent-hover': '#059669',
    '--sf-destructive': '#ef4444',
    '--sf-success': '#22c55e',
    '--sf-warning': '#eab308',
    '--sf-radius-md': '10px',
    '--sf-radius-lg': '12px',
    '--sf-radius-xl': '16px',
    '--sf-border-width': '1px',
    '--sf-font-ui': "'Geist Sans', system-ui, sans-serif",
    '--sf-transition': '180ms',
  },
  mech: {
    ...BASE_STRUCTURE,
    '--sf-bg-app': '#0c0c0e',
    '--sf-bg-surface': '#141418',
    '--sf-bg-elevated': '#1e1e24',
    '--sf-bg-overlay': '#28283a',
    '--sf-text': '#e0e0e8',
    '--sf-text-secondary': '#8888a0',
    '--sf-text-muted': '#606078',
    '--sf-text-disabled': '#404058',
    '--sf-border': '#1e1e30',
    '--sf-border-strong': '#2e2e48',
    '--sf-accent': '#00ff88',
    '--sf-accent-hover': '#00cc6a',
    '--sf-destructive': '#ff3366',
    '--sf-success': '#00ff88',
    '--sf-warning': '#ffaa00',
    '--sf-radius-md': '1px',
    '--sf-radius-lg': '2px',
    '--sf-radius-xl': '4px',
    '--sf-border-width': '2px',
    '--sf-font-ui': "'Geist Mono', ui-monospace, monospace",
    '--sf-transition': '80ms',
  },
};

/** Generate CSS custom properties block for a theme */
export function generateThemeCSS(theme: ThemeName): string {
  const tokens = THEME_DEFINITIONS[theme];
  return Object.entries(tokens)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n');
}

/** Generate all theme CSS blocks */
export function generateAllThemeCSS(): string {
  return THEME_NAMES.map(
    (name) => `:root[data-sf-theme="${name}"] {\n${generateThemeCSS(name)}\n}`
  ).join('\n\n');
}
```

- [ ] **Step 3: Write token tests**

```ts
// packages/ui/src/tokens/__tests__/themes.test.ts
import { describe, it, expect } from 'vitest';
import { THEME_NAMES, THEME_DEFINITIONS, generateThemeCSS } from '../themes';
import type { ThemeTokens } from '../colors';

describe('Theme Definitions', () => {
  const ALL_TOKEN_KEYS: (keyof ThemeTokens)[] = [
    '--sf-bg-app', '--sf-bg-surface', '--sf-bg-elevated', '--sf-bg-overlay',
    '--sf-text', '--sf-text-secondary', '--sf-text-muted', '--sf-text-disabled',
    '--sf-border', '--sf-border-strong',
    '--sf-accent', '--sf-accent-hover', '--sf-destructive', '--sf-success', '--sf-warning',
    '--sf-radius-sm', '--sf-radius-md', '--sf-radius-lg', '--sf-radius-xl', '--sf-radius-full',
    '--sf-border-width', '--sf-font-ui', '--sf-font-mono', '--sf-transition',
  ];

  it('defines exactly 7 themes', () => {
    expect(THEME_NAMES).toHaveLength(7);
    expect(THEME_NAMES).toEqual(['dark', 'light', 'ember', 'rust', 'ice', 'leaf', 'mech']);
  });

  it.each(THEME_NAMES)('%s theme has all required tokens', (theme) => {
    const tokens = THEME_DEFINITIONS[theme];
    for (const key of ALL_TOKEN_KEYS) {
      expect(tokens[key], `${theme} missing ${key}`).toBeDefined();
      expect(typeof tokens[key]).toBe('string');
      expect(tokens[key].length).toBeGreaterThan(0);
    }
  });

  it.each(THEME_NAMES)('%s color tokens are valid hex', (theme) => {
    const tokens = THEME_DEFINITIONS[theme];
    const colorKeys = ALL_TOKEN_KEYS.filter(k => k.startsWith('--sf-bg-') || k.startsWith('--sf-text') || k.startsWith('--sf-border') || k.startsWith('--sf-accent') || k.startsWith('--sf-destructive') || k.startsWith('--sf-success') || k.startsWith('--sf-warning'));
    for (const key of colorKeys) {
      expect(tokens[key], `${theme}.${key} = ${tokens[key]}`).toMatch(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
    }
  });

  it('generateThemeCSS produces valid CSS', () => {
    const css = generateThemeCSS('dark');
    expect(css).toContain('--sf-bg-app: #09090b');
    expect(css).toContain('--sf-accent: #3b82f6');
  });

  it('each theme has distinct accent color', () => {
    const accents = THEME_NAMES.map(t => THEME_DEFINITIONS[t]['--sf-accent']);
    const unique = new Set(accents);
    expect(unique.size).toBe(7);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd packages/ui && npx vitest run
```

Expected: All tests pass (cn tests + theme tests).

- [ ] **Step 5: Write remaining token files**

```ts
// packages/ui/src/tokens/spacing.ts
export const SPACING = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
} as const;
```

```ts
// packages/ui/src/tokens/typography.ts
export const FONT_FAMILY = {
  sans: "'Geist Sans', system-ui, sans-serif",
  mono: "'Geist Mono', ui-monospace, monospace",
} as const;

export const FONT_SIZE = {
  xs: '0.75rem',   // 12px
  sm: '0.875rem',  // 14px
  base: '1rem',    // 16px
  lg: '1.125rem',  // 18px
  xl: '1.25rem',   // 20px
  '2xl': '1.5rem', // 24px
} as const;

export const FONT_WEIGHT = {
  regular: '400',
  medium: '500',
  semibold: '600',
} as const;
```

```ts
// packages/ui/src/tokens/radius.ts
// Note: these are defaults. Actual values come from the theme via CSS custom properties.
export const RADIUS = {
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '12px',
  full: '9999px',
} as const;
```

```ts
// packages/ui/src/tokens/z-index.ts
/** Hardcoded z-index scale — NOT CSS custom properties (per reviewer requirement) */
export const Z_INDEX = {
  effects: 5,
  panels: 10,
  modals: 50,
  tooltips: 60,
  toasts: 70,
} as const;
```

```ts
// packages/ui/src/tokens/index.ts
export { THEME_NAMES, type ThemeName, type ThemeColorTokens, type ThemeStructureTokens, type ThemeTokens } from './colors';
export { THEME_DEFINITIONS, generateThemeCSS, generateAllThemeCSS } from './themes';
export { SPACING } from './spacing';
export { FONT_FAMILY, FONT_SIZE, FONT_WEIGHT } from './typography';
export { RADIUS } from './radius';
export { Z_INDEX } from './z-index';
```

- [ ] **Step 6: Write theme.css (Tailwind v4 @utility shortcuts)**

```css
/* packages/ui/src/tokens/theme.css */

/* Static spacing tokens — safe for @theme (don't change per theme) */
@theme {
  --spacing-sf-1: 4px;
  --spacing-sf-2: 8px;
  --spacing-sf-3: 12px;
  --spacing-sf-4: 16px;
  --spacing-sf-6: 24px;
  --spacing-sf-8: 32px;
}

/* Utility shortcuts for semantic color tokens.
   Color tokens use var() for runtime theme switching — @theme can't do this.
   @utility creates named classes that resolve at runtime. */
@utility sf-surface { background-color: var(--sf-bg-surface); }
@utility sf-elevated { background-color: var(--sf-bg-elevated); }
@utility sf-overlay { background-color: var(--sf-bg-overlay); }
@utility sf-text { color: var(--sf-text); }
@utility sf-text-secondary { color: var(--sf-text-secondary); }
@utility sf-text-muted { color: var(--sf-text-muted); }
@utility sf-text-disabled { color: var(--sf-text-disabled); }
@utility sf-border { border-color: var(--sf-border); }
@utility sf-border-strong { border-color: var(--sf-border-strong); }
@utility sf-accent { color: var(--sf-accent); }
@utility sf-destructive { color: var(--sf-destructive); }
@utility sf-success { color: var(--sf-success); }
@utility sf-warning { color: var(--sf-warning); }
```

- [ ] **Step 7: Update index.ts exports**

```ts
// packages/ui/src/index.ts
export { cn } from './utils/cn';
export {
  THEME_NAMES,
  type ThemeName,
  type ThemeColorTokens,
  type ThemeStructureTokens,
  type ThemeTokens,
  THEME_DEFINITIONS,
  generateThemeCSS,
  generateAllThemeCSS,
  SPACING,
  FONT_FAMILY,
  FONT_SIZE,
  FONT_WEIGHT,
  RADIUS,
  Z_INDEX,
} from './tokens';
```

- [ ] **Step 8: Build and verify**

```bash
cd packages/ui && npm run build && npx vitest run
```

Expected: Build succeeds, all tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/tokens/ packages/ui/src/index.ts
git commit -m "feat: design token definitions for all 7 themes + theme.css utilities"
```

---

### Task A6: useTheme() hook

**Files:**
- Create: `packages/ui/src/hooks/useTheme.ts`
- Test: `packages/ui/src/hooks/__tests__/useTheme.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/ui/src/hooks/__tests__/useTheme.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Dynamic import for module reset
let useTheme: typeof import('../useTheme').useTheme;

describe('useTheme', () => {
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    document.documentElement.removeAttribute('data-sf-theme');
    document.documentElement.removeAttribute('data-sf-effects');
    const mod = await import('../useTheme');
    useTheme = mod.useTheme;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to dark when no localStorage', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('reads valid theme from localStorage', () => {
    localStorage.setItem('sf-theme', 'ember');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('ember');
  });

  it('falls back to dark for invalid localStorage value', () => {
    localStorage.setItem('sf-theme', 'notatheme');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('setTheme updates localStorage and data-sf-theme', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('ice'));
    expect(result.current.theme).toBe('ice');
    expect(localStorage.getItem('sf-theme')).toBe('ice');
    expect(document.documentElement.getAttribute('data-sf-theme')).toBe('ice');
  });

  it('effects default to on', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.effectsEnabled).toBe(true);
  });

  it('respects prefers-reduced-motion by forcing effects off', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    const { result } = renderHook(() => useTheme());
    expect(result.current.effectsEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd packages/ui && npx vitest run src/hooks/__tests__/useTheme.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement useTheme**

```ts
// packages/ui/src/hooks/useTheme.ts
import { useState, useEffect, useCallback, useMemo } from 'react';
import { THEME_NAMES, type ThemeName, THEME_DEFINITIONS } from '../tokens';

const VALID_THEMES = new Set<string>(THEME_NAMES);
const STORAGE_KEY_THEME = 'sf-theme';
const STORAGE_KEY_EFFECTS = 'sf-effects';

function readTheme(): ThemeName {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(STORAGE_KEY_THEME);
  return VALID_THEMES.has(stored ?? '') ? (stored as ThemeName) : 'dark';
}

function readEffects(): boolean {
  if (typeof window === 'undefined') return true;
  // prefers-reduced-motion overrides user preference
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const stored = localStorage.getItem(STORAGE_KEY_EFFECTS);
  return stored !== 'off';
}

function applyThemeToDOM(theme: ThemeName) {
  const tokens = THEME_DEFINITIONS[theme];
  const root = document.documentElement;
  root.setAttribute('data-sf-theme', theme);
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value);
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeName>(readTheme);
  const [effectsEnabled, setEffectsEnabledState] = useState<boolean>(readEffects);

  // Apply theme to DOM on mount and change
  useEffect(() => {
    applyThemeToDOM(theme);
  }, [theme]);

  // Apply effects attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-sf-effects', effectsEnabled ? 'on' : 'off');
  }, [effectsEnabled]);

  const setTheme = useCallback((newTheme: ThemeName) => {
    if (!VALID_THEMES.has(newTheme)) return;
    localStorage.setItem(STORAGE_KEY_THEME, newTheme);
    setThemeState(newTheme);
  }, []);

  const setEffectsEnabled = useCallback((enabled: boolean) => {
    // prefers-reduced-motion always wins
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      localStorage.setItem(STORAGE_KEY_EFFECTS, 'off');
      setEffectsEnabledState(false);
      return;
    }
    localStorage.setItem(STORAGE_KEY_EFFECTS, enabled ? 'on' : 'off');
    setEffectsEnabledState(enabled);
  }, []);

  return useMemo(() => ({
    theme,
    setTheme,
    effectsEnabled,
    setEffectsEnabled,
    themes: THEME_NAMES,
  }), [theme, setTheme, effectsEnabled, setEffectsEnabled]);
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/ui && npx vitest run src/hooks/__tests__/useTheme.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Export from index**

Add to `packages/ui/src/index.ts`:
```ts
export { useTheme } from './hooks/useTheme';
```

- [ ] **Step 6: Build + full test**

```bash
cd packages/ui && npm run build && npx vitest run
```

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/hooks/ packages/ui/src/index.ts
git commit -m "feat: useTheme() hook with localStorage persistence, validation, reduced-motion"
```

---

### Task A7: DB migration for projects.theme column

**Files:**
- Modify: `web/src/lib/db/schema.ts`

- [ ] **Step 1: Add theme column to projects table**

In `web/src/lib/db/schema.ts`, add to the `projects` table definition (after `formatVersion`):

```ts
theme: text('theme'),  // nullable, no default — null means "use global default"
```

- [ ] **Step 2: Generate migration**

```bash
cd web && npm run db:generate
```

Expected: New migration file in `web/drizzle/` with `ALTER TABLE projects ADD COLUMN theme TEXT`.

- [ ] **Step 3: Apply to dev DB**

```bash
cd web && npm run db:push
```

Expected: Column added to dev database.

- [ ] **Step 4: Verify**

```bash
cd web && npx drizzle-kit studio
```

Check the `projects` table — `theme` column should be visible (nullable TEXT).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/db/schema.ts web/drizzle/
git commit -m "feat: add theme column to projects table (nullable TEXT)"
```

---

### Task A8: Wire theme.css into web/globals.css

**Files:**
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Import theme.css**

Add at the top of `web/src/app/globals.css` (after the tailwindcss import):

```css
@import '@spawnforge/ui/tokens/theme.css';
```

- [ ] **Step 2: Add default theme CSS variables**

Below the existing `:root` block, add the Dark theme as default:

```css
:root {
  /* ... existing vars ... */

  /* SpawnForge design tokens — Dark theme default */
  --sf-bg-app: #09090b;
  --sf-bg-surface: #18181b;
  --sf-bg-elevated: #27272a;
  --sf-bg-overlay: #3f3f46;
  --sf-text: #fafafa;
  --sf-text-secondary: #a1a1aa;
  --sf-text-muted: #71717a;
  --sf-text-disabled: #52525b;
  --sf-border: #27272a;
  --sf-border-strong: #3f3f46;
  --sf-accent: #3b82f6;
  --sf-accent-hover: #2563eb;
  --sf-destructive: #ef4444;
  --sf-success: #22c55e;
  --sf-warning: #eab308;
  --sf-radius-sm: 4px;
  --sf-radius-md: 6px;
  --sf-radius-lg: 8px;
  --sf-radius-xl: 12px;
  --sf-radius-full: 9999px;
  --sf-border-width: 1px;
  --sf-font-ui: 'Geist Sans', system-ui, sans-serif;
  --sf-font-mono: 'Geist Mono', ui-monospace, monospace;
  --sf-transition: 150ms;
}
```

Note: `useTheme()` applies theme-specific overrides via `style.setProperty()` at runtime. These `:root` defaults ensure the page renders correctly before JS hydrates.

- [ ] **Step 3: Verify dev server**

```bash
cd web && npm run dev
```

Expected: No visual changes (Dark theme matches existing zinc values).

- [ ] **Step 4: Commit**

```bash
git add web/src/app/globals.css
git commit -m "feat: wire @spawnforge/ui theme.css + default dark tokens into globals.css"
```

---

### Task A9: Theme switcher in Settings panel (end of Plan A)

> **Note:** This task creates a minimal theme switcher. The full swatch grid UX (spec Section 8) ships in Plan B alongside the Settings panel composite extraction. This is a functional dropdown to verify the plumbing works end-to-end.

**Files:**
- Modify: `web/src/components/settings/SettingsPanel.tsx` (or create if doesn't exist)

- [ ] **Step 1: Add theme selector to Settings**

Find the Settings panel component and add a theme dropdown section:

```tsx
import { useTheme, THEME_NAMES } from '@spawnforge/ui';

// In the component render:
const { theme, setTheme, effectsEnabled, setEffectsEnabled } = useTheme();

// In the JSX:
<div className="space-y-2">
  <label className="text-sm font-medium sf-text">Theme</label>
  <select
    value={theme}
    onChange={(e) => setTheme(e.target.value as ThemeName)}
    className="w-full rounded-[var(--sf-radius-md)] border-[var(--sf-border-width)] bg-[var(--sf-bg-elevated)] sf-text sf-border px-3 py-2 text-sm"
  >
    {THEME_NAMES.map((t) => (
      <option key={t} value={t}>
        {t.charAt(0).toUpperCase() + t.slice(1)}
      </option>
    ))}
  </select>
</div>

<div className="flex items-center gap-2 mt-4">
  <input
    type="checkbox"
    checked={effectsEnabled}
    onChange={(e) => setEffectsEnabled(e.target.checked)}
    id="sf-effects-toggle"
  />
  <label htmlFor="sf-effects-toggle" className="text-sm sf-text-secondary">
    Ambient effects
  </label>
</div>
```

- [ ] **Step 2: Test manually**

```bash
cd web && npm run dev
```

Open Settings, change theme dropdown. Verify:
- `data-sf-theme` attribute changes on `<html>`
- CSS custom properties update (check DevTools)
- Persists across page reload

- [ ] **Step 3: Commit**

```bash
git add web/src/components/settings/
git commit -m "feat: theme switcher dropdown in Settings panel"
```

---

**Plan A complete.** At this point:
- Workspace monorepo is functional
- `@spawnforge/ui` package builds, tests, and exports
- All 7 theme token definitions exist with tests
- `useTheme()` hook handles persistence, validation, and reduced-motion
- DB has `theme` column on projects
- Theme switching works end-to-end in the editor

---

# Plan B: Components + Storybook (Phase 2)

> **Depends on:** Plan A complete.
> **What ships:** 20 tier 1 primitives, Dark + Light themes verified with axe, Storybook deployed to `design.spawnforge.ai`, Chromatic connected.

*Full task-level detail for Plan B will follow the same pattern as Plan A — test-first, exact file paths, exact code, exact commands. Writing this next...*

---

# Plan C: Themed Effects (Phases 3-4)

> **Depends on:** Plan B (Storybook for Chromatic baselines).
> **What ships:** CSS-only ambient effects for all 7 themes, `ThemeAmbient` router, `prefers-reduced-motion` enforcement, effects toggle, Chromatic baselines.

*Task-level detail follows...*

---

# Plan D: Custom Themes + Composites (Phase 5)

> **Depends on:** Plan B (primitives), Plan C (theme definitions finalized).
> **What ships:** `themeValidator.ts` with full negative test suite, custom theme import/export UI, tier 2 composite extraction, internal Storybook build.

*Task-level detail follows...*

---

# Plan E: Backend Consolidation (Phase 6)

> **Depends on:** Plan A only (independent of B/C/D).
> **What ships:** `ApiErrorResponse` type, `apiError()` helper, withApiMiddleware migration (48 routes, 5 PR batches), Zod validation everywhere.

*Task-level detail follows...*

---

# Plan F: Frontend Consolidation + Migration (Phase 7)

> **Depends on:** Plan A only (independent of B/C/D).
> **What ships:** Zustand selector refactor (8 components), dialog a11y adoption, `sf-migrate-tokens` codemod, `no-hardcoded-primitives` lint rule, incremental editor migration.

*Task-level detail follows...*

---

## Inter-Plan Dependencies (Verified)

| Dependency | Why | Verified in |
|-----------|-----|-------------|
| A → B | Primitives import from `@spawnforge/ui` tokens | Task A3 (transpilePackages) |
| A → C | Effects use `data-sf-theme` attribute | Task A6 (useTheme sets attribute) |
| A → D | Custom themes validate against token catalog | Task A5 (token types exported) |
| A → E | Backend uses new `apiError()` but no token deps | Independent |
| A → F | Codemod maps zinc → sf-* tokens | Task A5 (token names defined) |
| B → C | Chromatic needs Storybook deployed | Plan B deploys Storybook |
| B → D | SettingsPanel composite needed for import UI | Plan B extracts composites |
| C → D | Custom themes inherit effects from built-in | Plan C defines all effects |
| E ∥ F | Backend and frontend consolidation are independent | No cross-deps |
