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
 *
 * `lib/playMode/` joined the same way (PF-1199): `verifyExecutor` value-imports
 * `winnabilityValidator` so the verify step asks the REAL play gate whether the
 * generated game can be won instead of restating its rules. That put the whole
 * subtree on the server graph, and its own `@/stores/slices/types` import has to
 * stay `import type` for the same reason `lib/game/` does.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  collectSourceFiles,
  isTypeOnlyOccurrence,
  stripComments,
} from '@/test/utils/importScanner';

/** `web/src/lib` — the base every reported path is relative to. */
const LIB = join(__dirname, '..', '..');

const GUARDED_ROOTS = [
  join(LIB, 'game-creation'),
  join(LIB, 'game'),
  join(LIB, 'playMode'),
];

/** Modules that pull client-only React state into whatever imports them. */
const CLIENT_ONLY_SPECIFIERS = ['@/stores/', '@/hooks/useEngine'];

/*
 * `collectSourceFiles`, `stripComments` and `isTypeOnlyOccurrence` live in
 * `@/test/utils/importScanner`. They started here, and moved when a second
 * RSC-boundary test (`lib/chat/__tests__/apiHandlerReachability.test.ts`)
 * needed the same three primitives: two hand-rolled comment strippers is
 * precisely how one of them quietly stops catching things. The helper tests at
 * the bottom of this file still exercise them through this import.
 */

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
