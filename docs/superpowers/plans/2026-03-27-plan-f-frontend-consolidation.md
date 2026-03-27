# Plan F: Frontend Consolidation + Migration (Phase 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Zustand selector refactor, dialog a11y adoption, AST-based codemod tool for zinc→token migration, `no-hardcoded-primitives` lint rule, incremental editor component migration.

**Depends on:** Plan A only (independent of B/C/D).

---

## Task F1: Zustand selector granularity (8 components)

**Files:**
- Modify: 8 component files in `web/src/components/`

- [ ] **Step 1: Find all components using full store destructuring**

```bash
grep -rn "const {.*} = useEditorStore()" web/src/components/ --include="*.tsx" | grep -v "__tests__"
```

- [ ] **Step 2: For each match, replace with individual selectors**

Before:
```tsx
const { selectedIds, primaryId, sceneGraph } = useEditorStore();
```

After:
```tsx
const selectedIds = useEditorStore((s) => s.selectedIds);
const primaryId = useEditorStore((s) => s.primaryId);
const sceneGraph = useEditorStore((s) => s.sceneGraph);
```

- [ ] **Step 3: Run affected component tests**

```bash
cd web && npx vitest run src/components/editor/__tests__/<component>.test.tsx
```

- [ ] **Step 4: Commit per component**

One commit per file modified. 8 commits total.

---

## Task F2: Dialog a11y adoption (remaining modals)

**Files:**
- Modify: modal/dialog components that use `fixed inset-0` without `useDialogA11y`

- [ ] **Step 1: Find all modals missing useDialogA11y**

```bash
grep -rn "fixed inset-0" web/src/components/ --include="*.tsx" | grep -v "useDialogA11y" | grep -v "__tests__" | grep -v "ThemeAmbient"
```

- [ ] **Step 2: For each, wire useDialogA11y**

```tsx
import { useDialogA11y } from '@spawnforge/ui';

// In the component:
const { dialogProps, titleProps } = useDialogA11y({
  title: 'Dialog Title',
  isOpen,
  onClose,
});

// Apply to the dialog root:
<div {...dialogProps} className="fixed inset-0 ...">
  <h2 {...titleProps}>Title</h2>
```

- [ ] **Step 3: Test each dialog**

Verify: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` matches title ID, focus trap works, Escape closes.

- [ ] **Step 4: Commit per dialog**

---

## Task F3: sf-migrate-tokens codemod (AST-based)

**Files:**
- Create: `scripts/sf-migrate-tokens.ts`
- Test: `scripts/__tests__/sf-migrate-tokens.test.ts`

- [ ] **Step 1: Install jscodeshift**

```bash
npm install -D jscodeshift @types/jscodeshift
```

- [ ] **Step 2: Write the codemod transform**

```ts
// scripts/sf-migrate-tokens.ts
import type { API, FileInfo } from 'jscodeshift';

const CLASS_MAP: Record<string, string> = {
  // Backgrounds
  'bg-zinc-950': 'bg-[var(--sf-bg-app)]',
  'bg-zinc-900': 'bg-[var(--sf-bg-surface)]',
  'bg-zinc-800': 'bg-[var(--sf-bg-elevated)]',
  'bg-zinc-800/20': 'bg-[var(--sf-bg-elevated)]',
  'bg-zinc-700': 'bg-[var(--sf-bg-overlay)]',
  // Text
  'text-zinc-50': 'text-[var(--sf-text)]',
  'text-white': 'text-[var(--sf-text)]',
  'text-zinc-400': 'text-[var(--sf-text-secondary)]',
  'text-zinc-500': 'text-[var(--sf-text-muted)]',
  'text-zinc-600': 'text-[var(--sf-text-disabled)]',
  // Borders
  'border-zinc-700': 'border-[var(--sf-border)]',
  'border-zinc-800': 'border-[var(--sf-border)]',
  'border-zinc-600': 'border-[var(--sf-border-strong)]',
  // Same patterns for stone-* and slate-*
  'bg-stone-950': 'bg-[var(--sf-bg-app)]',
  'bg-stone-900': 'bg-[var(--sf-bg-surface)]',
  'bg-slate-950': 'bg-[var(--sf-bg-app)]',
  'bg-slate-900': 'bg-[var(--sf-bg-surface)]',
};

export default function transform(file: FileInfo, api: API) {
  const j = api.jscodeshift;
  const root = j(file.source);

  // Find all JSX string literals that contain class names
  root.find(j.StringLiteral).forEach((path) => {
    const value = path.node.value;
    let modified = value;

    for (const [from, to] of Object.entries(CLASS_MAP)) {
      // Word-boundary replacement to avoid partial matches
      const regex = new RegExp(`\\b${from.replace(/[/]/g, '\\/')}\\b`, 'g');
      modified = modified.replace(regex, to);
    }

    if (modified !== value) {
      path.node.value = modified;
    }
  });

  // Also handle template literals in className
  root.find(j.TemplateLiteral).forEach((path) => {
    for (const quasi of path.node.quasis) {
      let value = quasi.value.raw;
      for (const [from, to] of Object.entries(CLASS_MAP)) {
        const regex = new RegExp(`\\b${from.replace(/[/]/g, '\\/')}\\b`, 'g');
        value = value.replace(regex, to);
      }
      quasi.value.raw = value;
      quasi.value.cooked = value;
    }
  });

  return root.toSource();
}
```

- [ ] **Step 3: Write tests for the codemod**

```ts
// scripts/__tests__/sf-migrate-tokens.test.ts
import { describe, it, expect } from 'vitest';
import { applyTransform } from 'jscodeshift/dist/testUtils';
import transform from '../sf-migrate-tokens';

describe('sf-migrate-tokens codemod', () => {
  it('replaces bg-zinc-900 with token reference', () => {
    const input = `const x = "bg-zinc-900 p-4";`;
    const output = applyTransform(transform, {}, { source: input });
    expect(output).toContain('bg-[var(--sf-bg-surface)]');
    expect(output).toContain('p-4'); // Non-zinc classes preserved
  });

  it('replaces multiple zinc classes in one string', () => {
    const input = `const x = "bg-zinc-900 text-zinc-400 border-zinc-700";`;
    const output = applyTransform(transform, {}, { source: input });
    expect(output).toContain('bg-[var(--sf-bg-surface)]');
    expect(output).toContain('text-[var(--sf-text-secondary)]');
    expect(output).toContain('border-[var(--sf-border)]');
  });

  it('handles template literals', () => {
    const input = 'const x = `bg-zinc-900 ${condition ? "text-zinc-400" : "text-zinc-50"}`;';
    const output = applyTransform(transform, {}, { source: input });
    expect(output).toContain('bg-[var(--sf-bg-surface)]');
  });

  it('does not modify non-zinc classes', () => {
    const input = `const x = "bg-blue-500 text-red-300";`;
    const output = applyTransform(transform, {}, { source: input });
    expect(output).toBe(input);
  });

  it('handles stone and slate variants', () => {
    const input = `const x = "bg-stone-900 bg-slate-950";`;
    const output = applyTransform(transform, {}, { source: input });
    expect(output).toContain('bg-[var(--sf-bg-surface)]');
    expect(output).toContain('bg-[var(--sf-bg-app)]');
  });
});
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run scripts/__tests__/sf-migrate-tokens.test.ts
```

- [ ] **Step 5: Compile transform to JS (jscodeshift can't run .ts directly)**

```bash
npx tsc scripts/sf-migrate-tokens.ts --outDir scripts/dist --module commonjs --esModuleInterop true --target ES2022
```

- [ ] **Step 6: Create runner script**

```bash
#!/usr/bin/env bash
# scripts/run-migrate-tokens.sh
# Usage: bash scripts/run-migrate-tokens.sh web/src/components/editor/InspectorPanel.tsx
npx jscodeshift --parser=tsx --transform scripts/dist/sf-migrate-tokens.js "$@"
```

- [ ] **Step 6: Commit**

```bash
git add scripts/sf-migrate-tokens.ts scripts/__tests__/ scripts/run-migrate-tokens.sh
git commit -m "feat: AST-based sf-migrate-tokens codemod (jscodeshift)"
```

---

## Task F4: no-hardcoded-primitives lint rule

**Files:**
- Create: `scripts/check-hardcoded-primitives.sh`
- Modify: `.github/workflows/quality-gates.yml`

- [ ] **Step 1: Write the check script**

```bash
#!/usr/bin/env bash
# scripts/check-hardcoded-primitives.sh
# Fails if any @spawnforge/ui component uses hardcoded zinc/stone/slate classes.
# Warns for web/src/components/ files (incremental migration).

set -euo pipefail

ERRORS=0

# Strict: @spawnforge/ui components MUST NOT have hardcoded primitives
if grep -rn "bg-zinc-\|text-zinc-\|border-zinc-\|bg-stone-\|text-stone-\|bg-slate-\|text-slate-" packages/ui/src/ --include="*.tsx" --include="*.ts" 2>/dev/null; then
  echo "::error::@spawnforge/ui components contain hardcoded primitive classes"
  ERRORS=$((ERRORS + 1))
fi

# Warning: web/src/components/ files being migrated
COUNT=$(grep -rn "bg-zinc-\|text-zinc-\|border-zinc-" web/src/components/ --include="*.tsx" 2>/dev/null | wc -l || true)
if [ "$COUNT" -gt 0 ]; then
  echo "::warning::${COUNT} hardcoded zinc classes remain in web/src/components/ (migration in progress)"
fi

exit $ERRORS
```

- [ ] **Step 2: Add to CI**

```yaml
  hardcoded-primitives:
    name: Check Hardcoded Primitives
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bash scripts/check-hardcoded-primitives.sh
```

- [ ] **Step 3: Commit**

---

## Tasks F5-F12: Incremental editor migration (batched by directory)

Each batch: run codemod on a directory, manually review edge cases, fix any broken tests, commit.

| Task | Directory | Estimated Files |
|------|-----------|----------------|
| F5 | `web/src/components/editor/Inspector*.tsx` | ~8 files |
| F6 | `web/src/components/editor/Scene*.tsx` | ~5 files |
| F7 | `web/src/components/editor/Material*.tsx` + `Light*.tsx` | ~6 files |
| F8 | `web/src/components/editor/Audio*.tsx` + `Particle*.tsx` | ~5 files |
| F9 | `web/src/components/editor/Script*.tsx` + `Play*.tsx` | ~5 files |
| F10 | `web/src/components/editor/Terrain*.tsx` + `Animation*.tsx` | ~5 files |
| F11 | `web/src/components/editor/ui-builder/` + `visual-script/` + `shader-nodes/` | ~15 files |
| F12 | `web/src/components/{dashboard,community,pricing,settings,onboarding,play,game,marketplace,health,legal,marketing}/` | ~30 files |

For each batch:
1. Run codemod: `bash scripts/run-migrate-tokens.sh web/src/components/editor/Inspector*.tsx`
2. Review diff — fix any mismatches (ternaries, dynamic classes)
3. Run affected tests: `npx vitest run src/components/editor/__tests__/Inspector*`
4. Run lint: `npx eslint --max-warnings 0 web/src/components/editor/Inspector*.tsx`
5. Commit: `refactor: migrate Inspector components to design tokens`
6. Create PR

---

## Task F13: Final enforcement — error on new hardcoded primitives

Once all batches are complete:
- [ ] Change the lint script from warning to error for `web/src/components/` too
- [ ] Verify zero matches across the entire codebase
- [ ] Commit

---

**Plan F complete.** Deliverables: Zustand selectors refactored, dialog a11y adopted, AST codemod, lint enforcement, all editor components migrated to design tokens.
