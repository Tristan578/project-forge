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

  // Fix 4: Minimum 50ms enforced
  it('rejects 0ms duration (minimum is 50ms)', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-transition': '0ms' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects 1ms duration (minimum is 50ms)', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-transition': '1ms' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects 49ms duration (minimum is 50ms)', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-transition': '49ms' },
    });
    expect(result.ok).toBe(false);
  });

  it('accepts 50ms duration (minimum boundary)', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-transition': '50ms' },
    });
    expect(result.ok).toBe(true);
  });

  it('accepts 150ms duration (typical transition)', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-transition': '150ms' },
    });
    expect(result.ok).toBe(true);
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
// Fix 4: Require minimum 50ms to prevent 0ms (disabling transitions entirely) and sub-perceptible
// flash effects. Range is 50–2000ms. Pattern: 2-digit value must start with 5-9 (50–99ms),
// or be 3-4 digits (100–9999ms, capped by MAX_DURATION_MS check below).
const DURATION_REGEX = /^([5-9]\d|\d{3,4})ms$/;
const MAX_DURATION_MS = 2000;
const MAX_LENGTH_PX = 64;
const MAX_LENGTH_REM = 4;

// Fix 5: FONT_ALLOWLIST contains both full CSS font stacks AND their bare family names.
// The bare entries ('Geist Sans', 'Geist Mono') exist because some tooling (e.g. Storybook
// theme picker, simple CSS consumers) may pass just the primary family name without the
// full fallback stack. Both forms are validated as safe — no external URLs, no @import.
const FONT_ALLOWLIST = [
  'inherit',
  "'Geist Sans', system-ui, sans-serif",
  "'Geist Mono', ui-monospace, monospace",
  // Bare family names — same typefaces as above, without fallback stacks
  'Geist Sans',
  'Geist Mono',
  // Generic stacks without a named family — safe CSS-only values
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

// Fix 1: Branded type prevents raw parsed JSON from being passed to applyThemeTokens()
// or saveCustomTheme() without going through validateCustomTheme() first.
// The unique symbol makes it impossible to construct ValidatedTheme without the validator.
declare const _validated: unique symbol;

export interface ValidatedTheme {
  /** @internal Branding field — do NOT read or set. Created only by validateCustomTheme(). */
  readonly [_validated]: true;
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
    // Type cast is the ONLY place ValidatedTheme is constructed — this is intentional.
    // The branded [_validated] field cannot be set otherwise, enforcing the validator is called.
    theme: {
      [_validated]: true as const,
      schemaVersion: obj.schemaVersion as number,
      name,
      author,
      description,
      tokens: validatedTokens as Partial<ThemeTokens>,
    } as ValidatedTheme,
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
import { validateCustomTheme, type ValidatedTheme } from './themeValidator';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function saveCustomTheme(id: string, theme: ValidatedTheme): Promise<void> {
  await set(`sf-theme-${id}`, theme);
}

// Fix 3: Re-validate IndexedDB data before returning it.
// IndexedDB data could be stale (written by an older schema version) or corrupted.
// Running validateCustomTheme() on load ensures the branded type invariant holds
// even if the stored data predates the current schema version or validator rules.
export async function loadCustomTheme(id: string): Promise<ValidatedTheme | null> {
  if (!UUID_REGEX.test(id)) return null;
  const raw = await get(`sf-theme-${id}`);
  if (raw == null) return null;
  const result = validateCustomTheme(raw);
  return result.ok ? result.theme : null;
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
- Create: `packages/ui/src/composites/ThemeImportExport.tsx`
- Test: `packages/ui/src/composites/__tests__/ThemeImportExport.test.tsx`

Adds "Import Custom Theme" button with file picker, validation, toast feedback, and "Export Theme" for the current custom theme.

Fix 8: Full step-by-step implementation — no one-liners. Every state and error path is explicit.

### States and flows

**Empty state:** Show "No custom themes yet." with a dashed border card and an "Import .json" call-to-action button.

**File picker loading:** When the file picker opens, set `isPickerOpen = true` to show a loading indicator on the button. Reset on cancel or file selection.

**Parsing progress:** After file selection, show "Reading file…" toast (info variant, no auto-dismiss) until JSON.parse completes.

**Specific toast messages per validation failure:**
- File > 50KB: `"File is too large. Maximum allowed size is 50KB."`
- Invalid JSON: `"Could not parse the file. Is it a valid .json file?"`
- `schemaVersion` missing: `"Invalid theme: missing schemaVersion field."`
- Future schema version: `"This theme requires a newer version of SpawnForge."`
- Rejected token value: `"Invalid token value for {key}: {validator error message}"`
- Success: `"Theme '{name}' imported successfully."`

**Duplicate name modal:** If `listCustomThemes()` already contains a theme with the same name, show a modal:
> "A theme named '{name}' already exists. Replace it?"
> [Cancel] [Replace]
On [Replace]: delete the old entry, import the new one.

**Success preview:** After successful import, show the theme swatch inline (accent color + surface background) below the success toast.

**Export dialog:** "Export" button opens a dialog:
> "Download '{name}' as a .json file?"
> [Cancel] [Download]
Uses `URL.createObjectURL(new Blob([JSON.stringify(theme)], { type: 'application/json' }))` — revoke the URL after the download click to prevent memory leaks.

```tsx
// packages/ui/src/composites/ThemeImportExport.tsx
'use client';

import { useState, useRef, useCallback } from 'react';
import { validateCustomTheme } from '../utils/themeValidator';
import { saveCustomTheme, loadCustomTheme, listCustomThemes, deleteCustomTheme } from '../utils/themeStorage';
import { Toast, Modal, Button, Badge } from '../primitives';
import { cn } from '../utils/cn';

type ImportState =
  | { status: 'idle' }
  | { status: 'reading' }
  | { status: 'duplicate'; name: string; pendingJson: unknown }
  | { status: 'success'; name: string; accentColor: string; bgColor: string }
  | { status: 'error'; message: string };

export function ThemeImportExport() {
  const [state, setState] = useState<ImportState>({ status: 'idle' });
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [customThemes, setCustomThemes] = useState<string[]>([]);
  const [selectedForExport, setSelectedForExport] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshThemeList = useCallback(async () => {
    const ids = await listCustomThemes();
    setCustomThemes(ids);
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = '';
    setIsPickerOpen(false);

    if (!file) return;

    // File size check BEFORE JSON.parse
    if (file.size > 50_000) {
      setState({ status: 'error', message: 'File is too large. Maximum allowed size is 50KB.' });
      return;
    }

    setState({ status: 'reading' });

    let parsed: unknown;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch {
      setState({ status: 'error', message: 'Could not parse the file. Is it a valid .json file?' });
      return;
    }

    const result = validateCustomTheme(parsed, { byteSize: file.size });
    if (!result.ok) {
      setState({ status: 'error', message: `Invalid theme: ${result.error}` });
      return;
    }

    // Duplicate name detection
    const existingIds = await listCustomThemes();
    const isDuplicate = existingIds.some(async (id) => {
      const existing = await loadCustomTheme(id);
      return existing?.name === result.theme.name;
    });

    if (isDuplicate) {
      setState({ status: 'duplicate', name: result.theme.name, pendingJson: parsed });
      return;
    }

    const id = crypto.randomUUID();
    await saveCustomTheme(id, result.theme);
    await refreshThemeList();

    setState({
      status: 'success',
      name: result.theme.name,
      accentColor: (result.theme.tokens['--sf-accent'] ?? '#3b82f6') as string,
      bgColor: (result.theme.tokens['--sf-bg-surface'] ?? '#18181b') as string,
    });
  }, [refreshThemeList]);

  const handleReplaceDuplicate = useCallback(async () => {
    if (state.status !== 'duplicate') return;
    const { name, pendingJson } = state;

    const result = validateCustomTheme(pendingJson);
    if (!result.ok) {
      setState({ status: 'error', message: result.error });
      return;
    }

    // Find and delete the old entry
    const existingIds = await listCustomThemes();
    for (const id of existingIds) {
      const existing = await loadCustomTheme(id);
      if (existing?.name === name) await deleteCustomTheme(id);
    }

    const newId = crypto.randomUUID();
    await saveCustomTheme(newId, result.theme);
    await refreshThemeList();

    setState({
      status: 'success',
      name: result.theme.name,
      accentColor: (result.theme.tokens['--sf-accent'] ?? '#3b82f6') as string,
      bgColor: (result.theme.tokens['--sf-bg-surface'] ?? '#18181b') as string,
    });
  }, [state, refreshThemeList]);

  const handleExport = useCallback(async (id: string) => {
    const theme = await loadCustomTheme(id);
    if (!theme) return;
    const blob = new Blob([JSON.stringify(theme, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${theme.name.replace(/\s+/g, '-').toLowerCase()}.spawnforge-theme.json`;
    a.click();
    // Revoke immediately after click to prevent memory leak
    URL.revokeObjectURL(url);
    setShowExportDialog(false);
  }, []);

  return (
    <div className={cn('space-y-4 p-4')}>
      {/* Empty state */}
      {customThemes.length === 0 && state.status === 'idle' && (
        <div className={cn(
          'flex flex-col items-center gap-3 rounded-[var(--sf-radius-lg)]',
          'border-2 border-dashed border-[var(--sf-border)] p-8 text-center',
        )}>
          <p className="text-[var(--sf-text-muted)] text-sm">No custom themes yet.</p>
          <p className="text-[var(--sf-text-disabled)] text-xs">Import a .json theme file to get started.</p>
        </div>
      )}

      {/* Reading indicator */}
      {state.status === 'reading' && (
        <Toast variant="info" message="Reading file…" />
      )}

      {/* Error toast */}
      {state.status === 'error' && (
        <Toast
          variant="error"
          message={state.message}
          onDismiss={() => setState({ status: 'idle' })}
        />
      )}

      {/* Success preview */}
      {state.status === 'success' && (
        <>
          <Toast
            variant="success"
            message={`Theme '${state.name}' imported successfully.`}
            onDismiss={() => setState({ status: 'idle' })}
          />
          <div className="flex items-center gap-2 rounded-[var(--sf-radius-md)] border border-[var(--sf-border)] p-3">
            <div
              className="h-8 w-8 rounded-full border border-[var(--sf-border)]"
              style={{ background: state.accentColor }}
              aria-label={`Accent color: ${state.accentColor}`}
            />
            <div
              className="h-8 w-12 rounded border border-[var(--sf-border)]"
              style={{ background: state.bgColor }}
              aria-label={`Background: ${state.bgColor}`}
            />
            <span className="text-[var(--sf-text-secondary)] text-sm">{state.name}</span>
          </div>
        </>
      )}

      {/* Duplicate name modal */}
      {state.status === 'duplicate' && (
        <Modal
          open
          onClose={() => setState({ status: 'idle' })}
          title="Theme Already Exists"
          footer={
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setState({ status: 'idle' })}>Cancel</Button>
              <Button variant="destructive" onClick={handleReplaceDuplicate}>Replace</Button>
            </div>
          }
        >
          <p className="text-[var(--sf-text)] text-sm">
            A theme named <strong>'{state.name}'</strong> already exists. Replace it?
          </p>
        </Modal>
      )}

      {/* Export dialog */}
      {showExportDialog && selectedForExport && (
        <Modal
          open
          onClose={() => setShowExportDialog(false)}
          title="Export Theme"
          footer={
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowExportDialog(false)}>Cancel</Button>
              <Button onClick={() => handleExport(selectedForExport)}>Download</Button>
            </div>
          }
        >
          <p className="text-[var(--sf-text)] text-sm">
            Download this theme as a .json file to share or back it up.
          </p>
        </Modal>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          onClick={() => {
            setIsPickerOpen(true);
            fileInputRef.current?.click();
          }}
          disabled={isPickerOpen || state.status === 'reading'}
        >
          {isPickerOpen ? 'Opening…' : 'Import .json'}
        </Button>
        {customThemes.length > 0 && (
          <Button
            variant="outline"
            onClick={() => {
              setSelectedForExport(customThemes[0]);
              setShowExportDialog(true);
            }}
          >
            Export
          </Button>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleFileChange}
      />
    </div>
  );
}
```

- [ ] **Step 1: Write tests for ThemeImportExport**

```tsx
// packages/ui/src/composites/__tests__/ThemeImportExport.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeImportExport } from '../ThemeImportExport';

vi.mock('../../utils/themeStorage', () => ({
  saveCustomTheme: vi.fn().mockResolvedValue(undefined),
  loadCustomTheme: vi.fn().mockResolvedValue(null),
  listCustomThemes: vi.fn().mockResolvedValue([]),
  deleteCustomTheme: vi.fn().mockResolvedValue(undefined),
}));

describe('ThemeImportExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows empty state when no custom themes', () => {
    render(<ThemeImportExport />);
    expect(screen.getByText('No custom themes yet.')).not.toBeNull();
  });

  it('shows file-too-large error without parsing the file', async () => {
    render(<ThemeImportExport />);
    const file = new File([new ArrayBuffer(60_001)], 'huge.json', { type: 'application/json' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText(/too large/i)).not.toBeNull());
  });

  it('shows specific error for invalid JSON', async () => {
    render(<ThemeImportExport />);
    const file = new File(['not json {'], 'bad.json', { type: 'application/json' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText(/could not parse/i)).not.toBeNull());
  });

  it('shows Import button', () => {
    render(<ThemeImportExport />);
    expect(screen.getByRole('button', { name: /import/i })).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd packages/ui && npx vitest run src/composites/__tests__/ThemeImportExport.test.tsx
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/composites/ThemeImportExport.tsx packages/ui/src/composites/__tests__/
git commit -m "feat: ThemeImportExport — full import/export UI with empty state, error toasts, duplicate modal, success preview"
```

---

## Tasks D5-D13: Tier 2 composite extraction (9 components)

Each composite: extract from `web/src/components/editor/` → `packages/ui/src/composites/`, replace hardcoded zinc with tokens, write tests + stories.

| Task | Component | Key Notes |
|------|-----------|-----------|
| D5 | SettingsPanel | Full theme switcher swatch grid (spec Section 8 UX) — see detailed implementation below |
| D6 | InspectorPanel | Generic inspector container with collapsible sections |
| D7 | TreeView | Hierarchical list with expand/collapse, multi-select |
| D8 | WorkspaceLayout | Dockview wrapper with theme-aware panel chrome |
| D9 | PropertyGrid | Key-value grid for component properties |
| D10 | Vec3Input | 3-field numeric input composing Slider primitive |
| D11 | ColorPicker | HSL/hex color picker with theme swatches |
| D12 | SliderInput | Labeled slider composing Slider primitive |
| D13 | KeyboardShortcutsPanel | Searchable shortcut list |

---

### Task D5 Detail: SettingsPanel — Full Theme Swatch Grid (Fix 9)

> This is NOT just a dropdown. The spec Section 8 UX requires a swatch grid as the primary theme selection UI. Below is the complete implementation.

**Files:**
- Create: `packages/ui/src/composites/SettingsPanel.tsx`
- Test: `packages/ui/src/composites/__tests__/SettingsPanel.test.tsx`

**Layout:** Card grid — 7 theme cards in a `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` responsive grid.

**Each card contains:**
- Mini preview strip (3 swatches: bg-app, accent, text-on-accent)
- Theme name label
- Active indicator (checkmark or ring highlight)
- Optional "Per-project" checkbox if `showPerProjectCheckbox` is true

**Keyboard navigation:** Arrow keys cycle between cards. Enter/Space activates. Focus ring visible.

**Effects toggle:** A single Switch below the grid toggles `data-sf-effects`. Disabled when `prefers-reduced-motion: reduce`.

```tsx
// packages/ui/src/composites/SettingsPanel.tsx
'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import { THEME_NAMES, THEME_DEFINITIONS, type ThemeName } from '../tokens';
import { Switch } from '../primitives';
import { cn } from '../utils/cn';

export interface SettingsPanelProps {
  currentTheme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  effectsEnabled: boolean;
  onEffectsChange: (enabled: boolean) => void;
  /** If true, shows per-project theme override checkbox per card */
  showPerProjectCheckbox?: boolean;
  /** The per-project theme override (if any) */
  projectTheme?: ThemeName | null;
  onProjectThemeChange?: (theme: ThemeName | null) => void;
  className?: string;
}

function ThemeCard({
  theme,
  isActive,
  isProjectTheme,
  showPerProjectCheckbox,
  onSelect,
  onProjectToggle,
  tabIndex,
  isFocused,
}: {
  theme: ThemeName;
  isActive: boolean;
  isProjectTheme: boolean;
  showPerProjectCheckbox: boolean;
  onSelect: () => void;
  onProjectToggle: (checked: boolean) => void;
  tabIndex: number;
  isFocused: boolean;
}) {
  const tokens = THEME_DEFINITIONS[theme];
  const bg = tokens['--sf-bg-app'];
  const accent = tokens['--sf-accent'];
  const text = tokens['--sf-text'];

  return (
    <div
      role="radio"
      aria-checked={isActive}
      tabIndex={tabIndex}
      data-sf-theme-card={theme}
      className={cn(
        'relative flex flex-col gap-2 rounded-[var(--sf-radius-lg)] border p-3',
        'cursor-pointer select-none transition-colors duration-[var(--sf-transition)]',
        isActive
          ? 'border-[var(--sf-accent)] ring-2 ring-[var(--sf-accent)] ring-offset-1 ring-offset-[var(--sf-bg-app)]'
          : 'border-[var(--sf-border)] hover:border-[var(--sf-border-strong)]',
        isFocused && 'outline-none ring-2 ring-[var(--sf-accent)]',
      )}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {/* Mini preview: 3 color swatches */}
      <div
        className="flex gap-1 rounded-[var(--sf-radius-sm)] overflow-hidden h-8"
        aria-hidden="true"
      >
        <div className="flex-1" style={{ background: bg }} />
        <div className="flex-1" style={{ background: accent }} />
        <div className="flex-1" style={{ background: text }} />
      </div>

      {/* Theme name */}
      <span className="text-[var(--sf-text)] text-xs font-medium capitalize">{theme}</span>

      {/* Active checkmark */}
      {isActive && (
        <div
          className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--sf-accent)]"
          aria-hidden="true"
        >
          <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
            <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}

      {/* Per-project checkbox */}
      {showPerProjectCheckbox && (
        <label
          className="flex items-center gap-1.5 text-[var(--sf-text-muted)] text-xs cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={isProjectTheme}
            onChange={(e) => onProjectToggle(e.target.checked)}
            className="rounded border-[var(--sf-border)] accent-[var(--sf-accent)]"
            aria-label={`Set ${theme} as project theme`}
          />
          Project
        </label>
      )}
    </div>
  );
}

export function SettingsPanel({
  currentTheme,
  onThemeChange,
  effectsEnabled,
  onEffectsChange,
  showPerProjectCheckbox = false,
  projectTheme,
  onProjectThemeChange,
  className,
}: SettingsPanelProps) {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [reducedMotion, setReducedMotion] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const count = THEME_NAMES.length;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % count);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + count) % count);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (focusedIndex >= 0) onThemeChange(THEME_NAMES[focusedIndex]);
      }
    },
    [focusedIndex, onThemeChange],
  );

  return (
    <section className={cn('space-y-4', className)} aria-labelledby="theme-switcher-label">
      <h3 id="theme-switcher-label" className="text-[var(--sf-text-secondary)] text-xs font-semibold uppercase tracking-wide">
        Theme
      </h3>

      {/* Swatch grid — keyboard navigable as radiogroup */}
      <div
        ref={gridRef}
        role="radiogroup"
        aria-label="Select theme"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
        onKeyDown={handleKeyDown}
      >
        {THEME_NAMES.map((theme, i) => (
          <ThemeCard
            key={theme}
            theme={theme}
            isActive={currentTheme === theme}
            isProjectTheme={projectTheme === theme}
            showPerProjectCheckbox={showPerProjectCheckbox}
            onSelect={() => {
              setFocusedIndex(i);
              onThemeChange(theme);
            }}
            onProjectToggle={(checked) => {
              onProjectThemeChange?.(checked ? theme : null);
            }}
            tabIndex={i === 0 ? 0 : -1}
            isFocused={focusedIndex === i}
          />
        ))}
      </div>

      {/* Effects toggle */}
      <div className="flex items-center justify-between">
        <label className="text-[var(--sf-text)] text-sm">
          Ambient effects
          {reducedMotion && (
            <span className="ml-2 text-[var(--sf-text-muted)] text-xs">(disabled by system)</span>
          )}
        </label>
        <Switch
          checked={effectsEnabled && !reducedMotion}
          onChange={onEffectsChange}
          disabled={reducedMotion}
          label="Toggle ambient effects"
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 1: Write tests for SettingsPanel**

```tsx
// packages/ui/src/composites/__tests__/SettingsPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsPanel } from '../SettingsPanel';
import { THEME_NAMES } from '../../tokens';

describe('SettingsPanel', () => {
  const defaultProps = {
    currentTheme: 'dark' as const,
    onThemeChange: vi.fn(),
    effectsEnabled: true,
    onEffectsChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all 7 theme cards', () => {
    render(<SettingsPanel {...defaultProps} />);
    for (const theme of THEME_NAMES) {
      expect(screen.getByRole('radio', { name: new RegExp(theme, 'i') })).not.toBeNull();
    }
  });

  it('marks active theme as aria-checked=true', () => {
    render(<SettingsPanel {...defaultProps} currentTheme="ember" />);
    const emberCard = screen.getByRole('radio', { name: /ember/i });
    expect(emberCard.getAttribute('aria-checked')).toBe('true');
  });

  it('calls onThemeChange when a card is clicked', () => {
    const onThemeChange = vi.fn();
    render(<SettingsPanel {...defaultProps} onThemeChange={onThemeChange} />);
    const iceCard = screen.getByRole('radio', { name: /ice/i });
    fireEvent.click(iceCard);
    expect(onThemeChange).toHaveBeenCalledWith('ice');
  });

  it('supports ArrowRight keyboard navigation', () => {
    const onThemeChange = vi.fn();
    render(<SettingsPanel {...defaultProps} onThemeChange={onThemeChange} />);
    const grid = screen.getByRole('radiogroup');
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    // First ArrowRight from index -1 goes to index 0 (dark), Enter selects
    expect(onThemeChange).toHaveBeenCalled();
  });

  it('renders effects toggle', () => {
    render(<SettingsPanel {...defaultProps} />);
    expect(screen.getByText(/ambient effects/i)).not.toBeNull();
  });

  it('shows per-project checkboxes when showPerProjectCheckbox=true', () => {
    render(<SettingsPanel {...defaultProps} showPerProjectCheckbox />);
    const projectCheckboxes = screen.getAllByLabelText(/set .* as project theme/i);
    expect(projectCheckboxes).toHaveLength(THEME_NAMES.length);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd packages/ui && npx vitest run src/composites/__tests__/SettingsPanel.test.tsx
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/composites/SettingsPanel.tsx packages/ui/src/composites/__tests__/SettingsPanel.test.tsx
git commit -m "feat: SettingsPanel composite with full swatch grid, keyboard nav, per-project checkbox, effects toggle"
```

---

## Task D14: Internal Storybook build + Deployment Protection

- [ ] Configure separate Vercel project for internal build
- [ ] Set `INCLUDE_INTERNAL=true` in internal project env vars
- [ ] Enable Vercel Deployment Protection (SSO) on internal project
- [ ] Verify public build does NOT contain internal stories
- [ ] Verify internal build DOES contain them

- [ ] **Fix 2: Add CI gate — public Storybook must NOT expose internal components**

Add to `.github/workflows/quality-gates.yml`:

```yaml
  storybook-internal-gate:
    name: Storybook Internal Leak Gate
    runs-on: ubuntu-latest
    needs: [storybook-build]
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v6
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: package-lock.json
      - run: npm ci
      - run: cd packages/ui && npm run build

      - name: Build public Storybook (INCLUDE_INTERNAL not set)
        run: cd apps/design && npm run build-storybook -- --output-dir storybook-public
        env:
          # Explicitly unset to ensure the public build path is tested
          INCLUDE_INTERNAL: ''

      - name: Assert no internal component names in public build
        run: |
          # Internal component names are exported only from packages/ui/src/internal.ts
          # and gated by INCLUDE_INTERNAL in apps/design/.storybook/main.ts.
          # If any leak into the public build, this gate catches them.
          INTERNAL_EXPORTS=$(node -e "
            const fs = require('fs');
            const src = fs.readFileSync('packages/ui/src/internal.ts', 'utf8');
            // Extract exported names from re-export lines
            const matches = src.match(/export \{ ([^}]+) \}/g) || [];
            const names = matches.flatMap(m => m.replace(/export \{ | \}/g, '').split(',').map(s => s.trim()));
            console.log(names.filter(Boolean).join('|'));
          ")

          if [ -z "$INTERNAL_EXPORTS" ]; then
            echo "No internal exports found — nothing to check."
            exit 0
          fi

          # Search the built Storybook output for any internal component name
          if grep -r --include="*.js" -E "$INTERNAL_EXPORTS" apps/design/storybook-public/ 2>/dev/null | head -5; then
            echo "::error::Public Storybook build contains internal component names. Check INCLUDE_INTERNAL gating."
            exit 1
          fi

          echo "PASS: No internal component names found in public Storybook build."
```

- [ ] Commit

---

---

## Task D15: Token backward compatibility tests (Fix 16)

**Files:**
- Create: `packages/ui/src/utils/__tests__/tokenBackwardCompat.test.ts`

Ensures that the theme token catalog is additive-only (new tokens never break existing theme objects) and that partial theme objects still inherit all missing tokens from the Dark theme default.

```ts
// packages/ui/src/utils/__tests__/tokenBackwardCompat.test.ts
import { describe, it, expect } from 'vitest';
import { validateCustomTheme } from '../themeValidator';
import { THEME_DEFINITIONS, type ThemeTokens } from '../../tokens';

describe('Token backward compatibility', () => {
  // Snapshot of the v1 schema token keys at catalog freeze time.
  // If new tokens are added to ThemeTokens, add them here too.
  // This test FAILS if a token is REMOVED from ThemeTokens (breaking change).
  const V1_TOKEN_KEYS: (keyof ThemeTokens)[] = [
    '--sf-bg-app', '--sf-bg-surface', '--sf-bg-elevated', '--sf-bg-overlay',
    '--sf-text', '--sf-text-secondary', '--sf-text-muted', '--sf-text-disabled',
    '--sf-border', '--sf-border-strong',
    '--sf-accent', '--sf-accent-hover', '--sf-destructive', '--sf-success', '--sf-warning',
    '--sf-radius-sm', '--sf-radius-md', '--sf-radius-lg', '--sf-radius-xl', '--sf-radius-full',
    '--sf-border-width', '--sf-font-ui', '--sf-font-mono', '--sf-transition',
  ];

  it('all v1 token keys still exist in ThemeTokens (no removals)', () => {
    const darkKeys = Object.keys(THEME_DEFINITIONS.dark) as (keyof ThemeTokens)[];
    for (const key of V1_TOKEN_KEYS) {
      expect(darkKeys, `Token ${key} was removed — breaking change!`).toContain(key);
    }
  });

  it('partial theme (only --sf-accent set) passes validation', () => {
    const result = validateCustomTheme({
      schemaVersion: 1,
      name: 'Partial',
      author: 'test',
      description: '',
      tokens: { '--sf-accent': '#aa00ff' },
    });
    expect(result.ok).toBe(true);
  });

  it('empty tokens object inherits all tokens from Dark theme at render time', () => {
    // validateCustomTheme accepts empty tokens — inheritance happens at applyThemeTokens time
    // (Dark theme CSS vars are applied first as defaults in globals.css, then overrides layer on top)
    const result = validateCustomTheme({
      schemaVersion: 1,
      name: 'Empty',
      author: 'test',
      description: '',
      tokens: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The validated theme has empty tokens — Dark defaults serve as base
      expect(Object.keys(result.theme.tokens)).toHaveLength(0);
    }
  });

  it('v1 schema with tokens added after catalog freeze still validates (additive)', () => {
    // Simulates a theme file that was created when the catalog had fewer tokens.
    // It should still pass validation even if new tokens were added later.
    const subsetTokens = {
      '--sf-accent': '#ff0000',
      '--sf-bg-app': '#000000',
    };
    const result = validateCustomTheme({
      schemaVersion: 1,
      name: 'Legacy',
      author: 'old-user',
      description: 'Created before catalog expansion',
      tokens: subsetTokens,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Only the provided tokens are in the validated object — missing ones use Dark defaults
      expect(result.theme.tokens['--sf-accent']).toBe('#ff0000');
      expect(result.theme.tokens['--sf-bg-app']).toBe('#000000');
    }
  });
});
```

- [ ] **Step 1: Run tests**

```bash
cd packages/ui && npx vitest run src/utils/__tests__/tokenBackwardCompat.test.ts
```

Expected: All 4 tests pass.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/utils/__tests__/tokenBackwardCompat.test.ts
git commit -m "test: token backward compatibility — v1 schema, partial sets, additive catalog"
```

---

**Plan D complete.** Deliverables: Custom theme validation + storage + import/export UI, 9 tier 2 composites, internal Storybook build, backward compatibility tests.
