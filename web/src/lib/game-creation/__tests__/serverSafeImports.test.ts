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
 * Scope, stated honestly: this checks `lib/game-creation/` only — the subtree
 * whose barrel is reachable from a server route today — and it is textual, so
 * it catches the direct import forms, not an alias laundered through a third
 * module. It is a tripwire for the regression that actually happened, not a
 * proof of the whole boundary. `next build` remains the authority.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');

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
 * True when the occurrence is erased at compile time and therefore contributes
 * no module edge: an `import type { … } from '…'` statement, or a deferred
 * `import('…')` sitting in type position (`: import('…').Foo`).
 *
 * Deliberately conservative — anything this cannot positively prove is
 * type-only is reported. `await import('…')` and a bare
 * `import x from '…'` both fall through to the failure path, which is the
 * point.
 */
function isTypeOnlyOccurrence(line: string): boolean {
  if (/^\s*import\s+type\s/.test(line)) return true;
  if (/^\s*export\s+type\s/.test(line)) return true;
  // `=> import('@/hooks/useEngine').BatchResult` / `: import('…').Foo`
  if (/[:=]>?\s*import\((['"])[^'"]+\1\)\s*\./.test(line)) return true;
  return false;
}

describe('game-creation server-safe imports', () => {
  const files = collectSourceFiles(ROOT);

  it('finds source files to check (fails closed on a bad root)', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('never value-imports a client-only module', () => {
    const violations: string[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // A `//`-leading line is prose (several files explain this very rule).
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (!CLIENT_ONLY_SPECIFIERS.some(spec => line.includes(spec))) return;
        if (isTypeOnlyOccurrence(line)) return;
        violations.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
      });
    }

    expect(
      violations,
      'A value import of a client-only module from lib/game-creation/ breaks ' +
        '`next build` via /api/game/decompose. Use `import type`, or take the ' +
        'value through ExecutorContext (e.g. `getStore()`).',
    ).toEqual([]);
  });
});
