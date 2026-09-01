/**
 * Guards every API route's server-only module graph.
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
 * The old guard scanned four manually maintained lib/ subtrees for two literal
 * specifier prefixes. An API route could import a harmless-looking lib module
 * which imported another module which finally reached stores/, hooks/ or
 * components/; the direct textual scan saw none of that chain. This guard starts
 * at every real API `route.ts`, follows every first-party runtime edge,
 * and reports the shortest chain to client-only source. `next build` remains the
 * authority for package and bundler behaviour; this is the fast first-party
 * graph tripwire.
 */

import { afterAll, describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import {
  chainTo,
  collectSourceFiles,
  isTypeOnlyOccurrence,
  stripComments,
  walkModuleGraph,
} from '@/test/utils/importScanner';

/** `web/src` — the base every reported path is relative to. */
const SRC = join(__dirname, '..', '..', '..');
const API_ROOT = join(SRC, 'app', 'api');
const CLIENT_ONLY_ROOTS = ['stores', 'hooks', 'components'].map(root => join(SRC, root));

function isWithin(file: string, root: string): boolean {
  const path = relative(root, file);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

/*
 * `collectSourceFiles`, `stripComments` and `isTypeOnlyOccurrence` live in
 * `@/test/utils/importScanner`. They started here, and moved when a second
 * RSC-boundary test (`lib/chat/__tests__/apiHandlerReachability.test.ts`)
 * needed the same three primitives: two hand-rolled comment strippers is
 * precisely how one of them quietly stops catching things. The helper tests at
 * the bottom of this file still exercise them through this import.
 */

describe('API route server-safe imports', () => {
  const routes = collectSourceFiles(API_ROOT).filter(file => /[\\/]route\.[cm]?[jt]sx?$/.test(file));
  // `stopAtClientBoundary` records a `'use client'` module but does not follow
  // its imports, which is the right question to ask of a SERVER graph. It is
  // forward-looking rather than a live fix: no API route reaches such a module
  // today (measured — both walks reach the same 210 files, 0 of them client
  // boundaries), so it changes nothing now. It keeps a future failure report
  // pointed at the route's own edge instead of trailing off into whatever that
  // component happens to pull in.
  const graph = walkModuleGraph(routes, SRC, { stopAtClientBoundary: true });

  // The failure this guards is a wrong API_ROOT: the walk comes back EMPTY and
  // all three assertions below pass vacuously. A count floor is the wrong shape
  // for that. Pinned near the live count (99) it reddens on a legitimate bulk
  // route removal, and whoever sees it red is being told a number moved, not
  // that the guard stopped guarding; pinned low it no longer separates "found
  // the tree" from "found one file". Assert the two structural properties
  // instead — the root resolved, and the walk reached a real route beneath it.
  it('resolves the API root', () => {
    expect(routes.length, `No route.ts under ${API_ROOT} — API_ROOT is wrong.`).toBeGreaterThan(0);
  });

  it('reaches a route beneath the API root', () => {
    // `/api/health` is the deploy smoke-test target, so it outlives any bulk
    // route change that would move a count.
    expect(routes.map(file => relative(API_ROOT, file))).toContain(join('health', 'route.ts'));
  });

  it('resolves every first-party runtime edge', () => {
    expect(
      graph.unresolved.map(([file, specifier]) => `${relative(SRC, file)} -> ${specifier}`),
      'An unresolved @/ or relative import is a hole in the module-graph walk.',
    ).toEqual([]);
  });

  it('never reaches client-only first-party source', () => {
    const violations = [...graph.parents.keys()]
      .filter(file => CLIENT_ONLY_ROOTS.some(root => isWithin(file, root)))
      .filter(file => {
        const parent = graph.parents.get(file);
        return parent == null || !CLIENT_ONLY_ROOTS.some(root => isWithin(parent, root));
      })
      .map(file => chainTo(file, graph.parents).map(part => relative(SRC, part)).join(' -> '));

    expect(
      violations,
      'An API route runtime-imports stores/, hooks/ or components/. Keep the ' +
        'edge type-only, or inject the value from a client boundary.',
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

  const fixture = mkdtempSync(join(tmpdir(), 'api-route-graph-'));
  afterAll(() => rmSync(fixture, { recursive: true, force: true }));

  it('resolves aliases and follows transitive runtime edges, but erases type edges', () => {
    const route = join(fixture, 'app', 'api', 'example', 'route.ts');
    const middle = join(fixture, 'lib', 'middle', 'index.ts');
    const store = join(fixture, 'stores', 'runtime.ts');
    const component = join(fixture, 'components', 'types.ts');
    for (const file of [route, middle, store, component]) mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(route, "export { run } from '@/lib/middle';\n");
    writeFileSync(
      middle,
      "export const run = () => import('@/stores/runtime');\n" +
        "export type View = import('@/components/types').View;\n",
    );
    writeFileSync(store, 'export const state = {};\n');
    writeFileSync(component, 'export interface View {}\n');

    const walked = walkModuleGraph([route], fixture);
    expect([...walked.parents.keys()]).toContain(store);
    expect([...walked.parents.keys()]).not.toContain(component);
    expect(walked.unresolved).toEqual([]);
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
