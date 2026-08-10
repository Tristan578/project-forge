/**
 * Guards the RSC boundary that `lib/game-creation/` sits on.
 *
 * `app/api/game/decompose/route.ts` — a React Server Component module — imports
 * `lib/game-creation/index.ts`, which re-exports the executor barrel, which
 * reaches every executor. Turbopack traces that graph through STATIC *and*
 * DYNAMIC imports alike, so a single `await import('@/stores/editorStore')`
 * inside an executor drags `hooks/useEngine` (and its `useSyncExternalStore`)
 * into the server bundle and fails `next build` with:
 *
 *   You're importing a module that depends on `useSyncExternalStore` into a
 *   React Server Component module.
 *
 * That shipped once (PF-1118): `tsc`, ESLint and vitest all pass on it, because
 * nothing about it is a type error or a runtime error — only a production build
 * can see it, and a production build is not part of the local gate. This test
 * makes the same mistake fail in ~10ms instead.
 *
 * Executors that need live store state take a getter through
 * `ExecutorContext.getStore()`, supplied by the (client-only) orchestrator. A
 * function value carries no module edge.
 *
 * Scope, stated honestly: this checks the subtrees listed in `GUARDED_ROOTS` —
 * those reachable from a server route today — and it is textual, so it catches
 * the direct import forms, not an alias laundered through a third module. It is
 * a tripwire for the regression that actually happened, not a proof of the whole
 * boundary. `next build` remains the authority.
 *
 * A root belongs here once a guarded module VALUE-imports it, because from that
 * moment its own imports are on the server graph too. `lib/game/` was added when
 * `sceneCreateExecutor` began importing the game-camera wire contract (PF-1126):
 * that module needs `GameCameraData` from `@/stores/slices/types`, and the whole
 * boundary now rests on that import staying `import type`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/** `web/src/lib` — the base every reported path is relative to. */
const LIB = join(__dirname, '..', '..');

const GUARDED_ROOTS = [join(LIB, 'game-creation'), join(LIB, 'game')];

/** Modules that pull client-only React state into whatever imports them. */
const CLIENT_ONLY_SPECIFIERS = ['@/stores/', '@/hooks/useEngine'];

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Blanks out comment text, preserving one output line per input line so a
 * violation still reports its true line number.
 *
 * A "does this line start with `//`" test is not good enough, and the gap is
 * exploitable in the false-PASS direction: `/* … *\/ const { useEditorStore } =
 * await import('@/stores/editorStore');` starts with `/*`, so a prefix test
 * skips the whole line — comment AND the real code after the terminator.
 *
 * Quote tracking is what keeps the strip itself from becoming the hole. A naive
 * "cut at the first `//`" blanks the tail of any line containing a URL in a
 * string literal, and blanked code is code this gate cannot see. Template-literal
 * state is deliberately reset per line: an unterminated quote means the rest of
 * the line survives into the scan, which over-reports rather than under-reports.
 */
function stripComments(source: string): string[] {
  const out: string[] = [];
  let inBlock = false;

  for (const line of source.split('\n')) {
    let kept = '';
    let quote: string | null = null;
    let i = 0;

    while (i < line.length) {
      const ch = line[i];
      const next = line[i + 1];

      if (inBlock) {
        if (ch === '*' && next === '/') {
          inBlock = false;
          i += 2;
        } else {
          i += 1;
        }
        continue;
      }

      if (quote !== null) {
        if (ch === '\\') {
          kept += ch + (next ?? '');
          i += 2;
          continue;
        }
        if (ch === quote) quote = null;
        kept += ch;
        i += 1;
        continue;
      }

      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        kept += ch;
        i += 1;
        continue;
      }
      if (ch === '/' && next === '/') break; // rest of the line is prose
      if (ch === '/' && next === '*') {
        inBlock = true;
        i += 2;
        continue;
      }

      kept += ch;
      i += 1;
    }

    out.push(kept);
  }

  return out;
}

/**
 * True when the occurrence is erased at compile time and therefore contributes
 * no module edge: an `import type { … } from '…'` statement, or a deferred
 * `import('…')` sitting in type position (`: import('…').Foo`).
 *
 * Deliberately conservative — anything this cannot positively prove is
 * type-only is reported. `await import('…')` and a bare
 * `import x from '…'` both fall through to the failure path, which is the
 * point.
 *
 * The type-position test requires member ACCESS, not a call. `import('…').Foo`
 * names a type; `import('…').then(m => m.useEditorStore)` is a runtime load
 * wearing the same first few characters, and an earlier version of this
 * function waved it through. The `\b` before the lookahead is load-bearing: it
 * stops the identifier match backtracking off `then` onto `the` and satisfying
 * the "not followed by `(`" test one character early.
 */
function isTypeOnlyOccurrence(line: string): boolean {
  if (/^\s*import\s+type\s/.test(line)) return true;
  if (/^\s*export\s+type\s/.test(line)) return true;
  // Anything that evaluates the module is a real edge, whatever shape it wears.
  if (/\bawait\s/.test(line) || /\.then\s*\(/.test(line)) return false;
  // `=> import('@/hooks/useEngine').BatchResult` / `: import('…').Foo`
  if (/[:=]>?\s*import\((['"])[^'"]+\1\)\s*\.[A-Za-z_$][\w$]*\b\s*(?!\()/.test(line)) return true;
  return false;
}

describe('game-creation server-safe imports', () => {
  const files = GUARDED_ROOTS.flatMap(collectSourceFiles);

  it('finds source files to check (fails closed on a bad root)', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  // A root that silently stops existing would take its coverage with it while
  // the aggregate count above stays comfortably over the threshold.
  it.each(GUARDED_ROOTS)('walks %s', root => {
    expect(collectSourceFiles(root).length).toBeGreaterThan(0);
  });

  it('never value-imports a client-only module', () => {
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const raw = source.split('\n');
      stripComments(source).forEach((line, i) => {
        if (!CLIENT_ONLY_SPECIFIERS.some(spec => line.includes(spec))) return;
        if (isTypeOnlyOccurrence(line)) return;
        violations.push(`${relative(LIB, file)}:${i + 1}: ${raw[i]?.trim() ?? line.trim()}`);
      });
    }

    expect(
      violations,
      'A value import of a client-only module from a server-reachable lib/ ' +
        'subtree breaks `next build` via /api/game/decompose. Use `import ' +
        'type`, or take the value through ExecutorContext (e.g. `getStore()`).',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The guard's own guard.
//
// Both helpers above shipped with a hole that let a real runtime import through
// — the failure mode of a tripwire is that it silently stops tripping, so the
// shapes that got past them are pinned here directly. Living in `__tests__/`,
// these lines are outside `collectSourceFiles`' walk, so they cannot trip the
// scan they describe.
// ---------------------------------------------------------------------------

describe('serverSafeImports helpers', () => {
  const RUNTIME_LOADS = [
    "const mod = await import('@/stores/editorStore');",
    "const { useEditorStore } = await import('@/stores/editorStore');",
    "const loadStore = () => import('@/stores/editorStore').then((m) => m.useEditorStore.getState());",
    "state.handler = import('@/stores/editorStore').then(m => m.useEditorStore);",
    "import('@/stores/editorStore').then(m => m.useEditorStore.getState());",
    "import { useEditorStore } from '@/stores/editorStore';",
    "export { useEditorStore } from '@/stores/editorStore';",
  ];

  const ERASED = [
    "import type { EditorState } from '@/stores/editorStore';",
    "export type { EditorState } from '@/stores/editorStore';",
    "  dispatchCommandBatch?: (c: C[]) => import('@/hooks/useEngine').BatchResult;",
    "  store: import('@/stores/editorStore').EditorState;",
  ];

  it.each(RUNTIME_LOADS)('treats a runtime load as a module edge: %s', line => {
    expect(isTypeOnlyOccurrence(line)).toBe(false);
  });

  it.each(ERASED)('treats a compile-time-erased occurrence as safe: %s', line => {
    expect(isTypeOnlyOccurrence(line)).toBe(true);
  });

  it('does not let an inline block comment hide the code after it', () => {
    const source =
      "/* eslint-disable-next-line */ const { useEditorStore } = await import('@/stores/editorStore');";
    const [stripped] = stripComments(source);

    expect(stripped).toContain('@/stores/editorStore');
    expect(isTypeOnlyOccurrence(stripped!)).toBe(false);
  });

  it('does not blank real code following a string that contains "//"', () => {
    const source = "const doc = 'https://example.com'; await import('@/stores/editorStore');";
    const [stripped] = stripComments(source);

    expect(stripped).toContain('@/stores/editorStore');
  });

  it('strips a multi-line block comment without losing line numbering', () => {
    const source = [
      '/**',
      " * Never import '@/stores/editorStore' here.",
      ' */',
      "import { thing } from '@/lib/thing';",
    ].join('\n');
    const stripped = stripComments(source);

    expect(stripped).toHaveLength(4);
    expect(stripped.slice(0, 3).join('')).not.toContain('@/stores/');
    expect(stripped[3]).toContain('@/lib/thing');
  });

  it('strips a trailing line comment but keeps the statement', () => {
    const source = "const x = 1; // never import '@/stores/editorStore'";
    const [stripped] = stripComments(source);

    expect(stripped).toBe('const x = 1; ');
  });
});
