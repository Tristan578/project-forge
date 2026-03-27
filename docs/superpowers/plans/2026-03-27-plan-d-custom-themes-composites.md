# Plan D: Custom Themes + Composites (Phase 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Custom theme JSON import/export with full validation, tier 2 composite extraction, internal Storybook build with Deployment Protection.

**Depends on:** Plan B (primitives), Plan C (themes finalized).

---

## Task D1: themeValidator.ts — JSON schema validation

**Files:**
- Create: `packages/ui/src/utils/themeValidator.ts`
- Test: `packages/ui/src/utils/__tests__/themeValidator.test.ts`

- [ ] **Step 1: Write failing tests — full negative test suite from spec Section 6.4**

```ts
// packages/ui/src/utils/__tests__/themeValidator.test.ts
import { describe, it, expect } from 'vitest';
import { validateCustomTheme, type ValidatedTheme } from '../themeValidator';

describe('themeValidator', () => {
  const VALID_THEME = {
    schemaVersion: 1,
    name: 'Test',
    author: 'dev',
    description: 'A test theme',
    tokens: { '--sf-accent': '#ff00ff' },
  };

  // Happy path
  it('accepts valid complete theme', () => {
    const result = validateCustomTheme(VALID_THEME);
    expect(result.ok).toBe(true);
  });

  it('accepts empty tokens (inherits Dark)', () => {
    const result = validateCustomTheme({ ...VALID_THEME, tokens: {} });
    expect(result.ok).toBe(true);
  });

  // schemaVersion
  it('rejects missing schemaVersion', () => {
    const { schemaVersion, ...rest } = VALID_THEME;
    const result = validateCustomTheme(rest as any);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('schemaVersion');
  });

  it.each([0, -1, 'latest', 2.5])('rejects invalid schemaVersion: %s', (v) => {
    const result = validateCustomTheme({ ...VALID_THEME, schemaVersion: v });
    expect(result.ok).toBe(false);
  });

  it('rejects future schemaVersion with specific message', () => {
    const result = validateCustomTheme({ ...VALID_THEME, schemaVersion: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('This theme requires SpawnForge v2');
      expect(result.error).toContain('Your version supports v1');
    }
  });

  it('rejects JSON exceeding 50KB via byteSize parameter', () => {
    // File size is checked pre-parse in the import UI (Task D4),
    // but validator also accepts optional byteSize for defense-in-depth
    const result = validateCustomTheme(VALID_THEME, { byteSize: 60_000 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('50KB');
  });

  // Token value validation
  it('rejects CSS injection in color token', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-accent': 'red; --x: url(evil)' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects url() in color token', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-accent': 'url(javascript:alert(1))' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects null token value', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-accent': null as any },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects font not in allowlist', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-font-ui': 'Comic Sans' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects font with url injection', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-font-mono': "'x', url(//evil)" },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects s unit in duration (ms only)', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-transition': '3s' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects duration exceeding 2000ms', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-transition': '5000ms' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects radius exceeding 64px', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-radius-md': '100px' },
    });
    expect(result.ok).toBe(false);
  });

  it('drops unknown token keys', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-accent': '#ff00ff', '--sf-custom-foo': '#000' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.theme.tokens as any)['--sf-custom-foo']).toBeUndefined();
    }
  });

  // Metadata
  it('rejects name exceeding 64 chars', () => {
    const result = validateCustomTheme({ ...VALID_THEME, name: 'x'.repeat(200) });
    expect(result.ok).toBe(false);
  });

  it('rejects description exceeding 256 chars', () => {
    const result = validateCustomTheme({ ...VALID_THEME, description: 'x'.repeat(300) });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Implement themeValidator.ts**

```ts
// packages/ui/src/utils/themeValidator.ts
import type { ThemeTokens, ThemeColorTokens, ThemeStructureTokens } from '../tokens';

const CURRENT_SCHEMA_VERSION = 1;
const HEX_REGEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const LENGTH_REGEX = /^\d+(\.\d+)?(px|rem)$/;
const DURATION_REGEX = /^\d+ms$/;
const MAX_DURATION_MS = 2000;
const MAX_LENGTH_PX = 64;
const MAX_LENGTH_REM = 4;

const FONT_ALLOWLIST = [
  'inherit',
  "'Geist Sans', system-ui, sans-serif",
  "'Geist Mono', ui-monospace, monospace",
  'Geist Sans',
  'Geist Mono',
  'system-ui, sans-serif',
  'ui-monospace, monospace',
];

const COLOR_TOKEN_KEYS = new Set<string>([
  '--sf-bg-app', '--sf-bg-surface', '--sf-bg-elevated', '--sf-bg-overlay',
  '--sf-text', '--sf-text-secondary', '--sf-text-muted', '--sf-text-disabled',
  '--sf-border', '--sf-border-strong',
  '--sf-accent', '--sf-accent-hover', '--sf-destructive', '--sf-success', '--sf-warning',
]);

const LENGTH_TOKEN_KEYS = new Set<string>([
  '--sf-radius-sm', '--sf-radius-md', '--sf-radius-lg', '--sf-radius-xl', '--sf-radius-full',
  '--sf-border-width',
]);

const FONT_TOKEN_KEYS = new Set<string>(['--sf-font-ui', '--sf-font-mono']);
const DURATION_TOKEN_KEYS = new Set<string>(['--sf-transition']);

const ALL_VALID_KEYS = new Set([...COLOR_TOKEN_KEYS, ...LENGTH_TOKEN_KEYS, ...FONT_TOKEN_KEYS, ...DURATION_TOKEN_KEYS]);

export interface ValidatedTheme {
  schemaVersion: number;
  name: string;
  author: string;
  description: string;
  tokens: Partial<ThemeTokens>;
}

type ValidationResult =
  | { ok: true; theme: ValidatedTheme }
  | { ok: false; error: string };

export function validateCustomTheme(
  input: unknown,
  options?: { byteSize?: number },
): ValidationResult {
  if (options?.byteSize && options.byteSize > 50_000) {
    return { ok: false, error: 'Theme file exceeds 50KB limit.' };
  }

  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Input must be a JSON object.' };
  }

  const obj = input as Record<string, unknown>;

  // schemaVersion
  if (!('schemaVersion' in obj) || typeof obj.schemaVersion !== 'number' || !Number.isInteger(obj.schemaVersion) || obj.schemaVersion < 1) {
    return { ok: false, error: 'Missing or invalid schemaVersion. Must be a positive integer.' };
  }
  if (obj.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return { ok: false, error: `This theme requires SpawnForge v${obj.schemaVersion}. Your version supports v${CURRENT_SCHEMA_VERSION}.` };
  }

  // Metadata
  const name = typeof obj.name === 'string' ? obj.name : '';
  const author = typeof obj.author === 'string' ? obj.author : '';
  const description = typeof obj.description === 'string' ? obj.description : '';

  if (name.length > 64) return { ok: false, error: 'Theme name must be 64 characters or fewer.' };
  if (author.length > 64) return { ok: false, error: 'Author must be 64 characters or fewer.' };
  if (description.length > 256) return { ok: false, error: 'Description must be 256 characters or fewer.' };

  // Tokens
  const rawTokens = typeof obj.tokens === 'object' && obj.tokens !== null ? obj.tokens as Record<string, unknown> : {};
  const validatedTokens: Record<string, string> = {};

  for (const [key, value] of Object.entries(rawTokens)) {
    if (!ALL_VALID_KEYS.has(key)) continue; // Drop unknown keys silently

    if (typeof value !== 'string') {
      return { ok: false, error: `Token ${key}: value must be a string.` };
    }

    if (COLOR_TOKEN_KEYS.has(key)) {
      if (!HEX_REGEX.test(value)) {
        return { ok: false, error: `Token ${key}: must be hex color like #ff00ff. Got: "${value}"` };
      }
    } else if (LENGTH_TOKEN_KEYS.has(key)) {
      if (!LENGTH_REGEX.test(value)) {
        return { ok: false, error: `Token ${key}: must be a length like 6px or 1rem. Got: "${value}"` };
      }
      const num = parseFloat(value);
      if (value.endsWith('px') && num > MAX_LENGTH_PX) {
        return { ok: false, error: `Token ${key}: max ${MAX_LENGTH_PX}px. Got: "${value}"` };
      }
      if (value.endsWith('rem') && num > MAX_LENGTH_REM) {
        return { ok: false, error: `Token ${key}: max ${MAX_LENGTH_REM}rem. Got: "${value}"` };
      }
    } else if (FONT_TOKEN_KEYS.has(key)) {
      if (!FONT_ALLOWLIST.includes(value)) {
        return { ok: false, error: `Token ${key}: must be one of the allowed font stacks. Got: "${value}"` };
      }
    } else if (DURATION_TOKEN_KEYS.has(key)) {
      if (!DURATION_REGEX.test(value)) {
        return { ok: false, error: `Token ${key}: must be in milliseconds like 150ms. Got: "${value}"` };
      }
      const ms = parseInt(value, 10);
      if (ms > MAX_DURATION_MS) {
        return { ok: false, error: `Token ${key}: max ${MAX_DURATION_MS}ms. Got: "${value}"` };
      }
    }

    validatedTokens[key] = value;
  }

  return {
    ok: true,
    theme: {
      schemaVersion: obj.schemaVersion as number,
      name,
      author,
      description,
      tokens: validatedTokens as Partial<ThemeTokens>,
    },
  };
}
```

- [ ] **Step 3: Run tests, verify all pass**
- [ ] **Step 4: Export from index.ts**
- [ ] **Step 5: Commit**

---

## Task D2: applyThemeTokens — DOM application (ValidatedTheme only)

**Files:**
- Create: `packages/ui/src/utils/applyThemeTokens.ts`
- Test: `packages/ui/src/utils/__tests__/applyThemeTokens.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyThemeTokens } from '../applyThemeTokens';
import type { ValidatedTheme } from '../themeValidator';

describe('applyThemeTokens', () => {
  beforeEach(() => {
    // Clear all custom properties
    document.documentElement.removeAttribute('style');
  });

  it('sets CSS custom properties on document root', () => {
    const theme: ValidatedTheme = {
      schemaVersion: 1, name: 'Test', author: '', description: '',
      tokens: { '--sf-accent': '#ff00ff' },
    };
    applyThemeTokens(theme);
    expect(document.documentElement.style.getPropertyValue('--sf-accent')).toBe('#ff00ff');
  });

  it('only accepts ValidatedTheme type (compile-time safety)', () => {
    // This test verifies the type signature — if it compiles, it passes
    const theme: ValidatedTheme = {
      schemaVersion: 1, name: '', author: '', description: '',
      tokens: {},
    };
    applyThemeTokens(theme);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// packages/ui/src/utils/applyThemeTokens.ts
import type { ValidatedTheme } from './themeValidator';

/**
 * Apply validated custom theme tokens to the DOM.
 * This is the SOLE call site for style.setProperty with theme values.
 * Only accepts ValidatedTheme — never raw parsed JSON.
 */
export function applyThemeTokens(theme: ValidatedTheme): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.tokens)) {
    if (typeof value === 'string') {
      root.style.setProperty(key, value);
    }
  }
}
```

- [ ] **Step 3: Test, export, commit**

---

## Task D3: Custom theme IndexedDB storage

**Files:**
- Create: `packages/ui/src/utils/themeStorage.ts`
- Test: `packages/ui/src/utils/__tests__/themeStorage.test.ts`

Uses `idb-keyval` (~600B, simplest API, good performance) for IndexedDB access.

- [ ] **Step 1: Install idb-keyval**

```bash
cd packages/ui && npm install idb-keyval
```

- [ ] **Step 2: Implement storage**

```ts
// packages/ui/src/utils/themeStorage.ts
import { get, set, del, keys } from 'idb-keyval';
import type { ValidatedTheme } from './themeValidator';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function saveCustomTheme(id: string, theme: ValidatedTheme): Promise<void> {
  await set(`sf-theme-${id}`, theme);
}

export async function loadCustomTheme(id: string): Promise<ValidatedTheme | null> {
  if (!UUID_REGEX.test(id)) return null;
  return (await get(`sf-theme-${id}`)) ?? null;
}

export async function deleteCustomTheme(id: string): Promise<void> {
  await del(`sf-theme-${id}`);
}

export async function listCustomThemes(): Promise<string[]> {
  const allKeys = await keys();
  return allKeys
    .filter((k): k is string => typeof k === 'string' && k.startsWith('sf-theme-'))
    .map((k) => k.replace('sf-theme-', ''));
}
```

- [ ] **Step 3: Test, export, commit**

---

## Task D4: Custom theme import/export UI in Settings

**Files:**
- Modify: Settings panel (from Task A9)

Adds "Import Custom Theme" button with file picker, validation, toast feedback, and "Export Theme" for the current custom theme.

- [ ] Detailed UI implementation follows the spec Section 6.5 requirements
- [ ] Includes duplicate name detection (prompt to replace)
- [ ] File size check (50KB max) before JSON.parse
- [ ] Validation error toasts with specific messages

---

## Tasks D5-D13: Tier 2 composite extraction (9 components)

Each composite: extract from `web/src/components/editor/` → `packages/ui/src/composites/`, replace hardcoded zinc with tokens, write tests + stories.

| Task | Component | Key Notes |
|------|-----------|-----------|
| D5 | SettingsPanel | Full theme switcher swatch grid (spec Section 8 UX) |
| D6 | InspectorPanel | Generic inspector container with collapsible sections |
| D7 | TreeView | Hierarchical list with expand/collapse, multi-select |
| D8 | WorkspaceLayout | Dockview wrapper with theme-aware panel chrome |
| D9 | PropertyGrid | Key-value grid for component properties |
| D10 | Vec3Input | 3-field numeric input composing Slider primitive |
| D11 | ColorPicker | HSL/hex color picker with theme swatches |
| D12 | SliderInput | Labeled slider composing Slider primitive |
| D13 | KeyboardShortcutsPanel | Searchable shortcut list |

---

## Task D14: Internal Storybook build + Deployment Protection

- [ ] Configure separate Vercel project for internal build
- [ ] Set `INCLUDE_INTERNAL=true` in internal project env vars
- [ ] Enable Vercel Deployment Protection (SSO) on internal project
- [ ] Verify public build does NOT contain internal stories
- [ ] Verify internal build DOES contain them
- [ ] Commit

---

**Plan D complete.** Deliverables: Custom theme validation + storage + import/export UI, 9 tier 2 composites, internal Storybook build.
