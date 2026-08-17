/**
 * Pins the reason `lib/chat/handlers/` is allowed to import Zustand stores.
 *
 * Most handler modules value-import a client-only store — some statically
 * (`exportHandlers` → `@/stores/editorStore`), some through an `await
 * import(…)` inside a handler body (`cutsceneHandlers` →
 * `@/stores/cutsceneStore`). Both forms are real module edges to Turbopack and
 * to the walk below. None of them is a defect, because the handlers are only
 * ever loaded from the client: nothing in the server graph can reach them.
 *
 * The count is deliberately not written down here. It moves whenever a handler
 * is added, and a stale number in a comment is worse than no number — the file
 * below asserts the property instead.
 *
 * That last clause is a claim about the codebase, and until now nothing checked
 * it. The day a server module imports `chat/executor` — or anything that leads
 * to it — those edges stop being harmless and `next build` fails with
 *
 *   You're importing a component that needs "useSyncExternalStore". That only
 *   works in a Client Component.
 *
 * on a module that never mentions a store (PF-1118 is the same shape, one
 * subtree over). The five-command local gate structurally cannot see it: `tsc`
 * type-checks the import fine, ESLint has no rule for it, and vitest resolves
 * every module in a single non-RSC graph.
 *
 * WHERE THE WALK STARTS AND STOPS. Entries are every shipped module under
 * `app/` — routes and server components alike, since both compile into the
 * server graph and both break identically. It stops at any module declaring
 * `'use client'`: that module IS the boundary, a server component may import
 * it, and everything beyond it is legitimately client code. Without that stop,
 * the ordinary `app/page.tsx` → client component → `chatStore` → `executor`
 * chain would report as a violation.
 *
 * WHY THIS SHAPE AND NOT A SEEDED ALLOWLIST. Widening
 * `serverSafeImports.test.ts` to scan `lib/chat/handlers/` would fire on every
 * one of those pre-existing edges, so it would need them seeded as exceptions —
 * and a frozen list of allowed edges never re-checks the property that makes
 * them safe. This asserts that property directly. It is weaker in reach and
 * stronger in meaning: it says nothing about which imports a handler may write,
 * and everything about why any of them are currently fine.
 *
 * SCOPE, STATED AS HONESTLY AS THE SCAN NEXT DOOR. The walk is textual (see
 * `test/utils/importScanner.ts`): it follows `from '…'`, side-effect `import
 * '…'`, `import('…')` and `require('…')` through `@/` and relative specifiers,
 * treating dynamic imports as real edges — Turbopack does. It does not follow a
 * specifier assembled at runtime, and it cannot see a lazy load hidden behind an
 * indirection like `loaders[name]()`. `next build` remains the authority.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import {
  chainTo,
  collectSourceFiles,
  extractSpecifiers,
  extractStatements,
  isInternalSpecifier,
  resolveSpecifier,
  stripComments,
  walkModuleGraph,
} from '@/test/utils/importScanner';

/** `web/src` — the base every reported path is relative to. */
const SRC = join(__dirname, '..', '..', '..');

const APP_ROOT = join(SRC, 'app');
const HANDLERS_ROOT = join(SRC, 'lib', 'chat', 'handlers');
const STORES_ROOT = join(SRC, 'stores');
const EXECUTOR = join(SRC, 'lib', 'chat', 'executor.ts');

const rel = (file: string) => relative(SRC, file);
const isHandler = (file: string) => file.startsWith(HANDLERS_ROOT + sep);
const isStore = (file: string) => file.startsWith(STORES_ROOT + sep);

describe('the server graph cannot reach lib/chat/handlers', () => {
  const entries = collectSourceFiles(APP_ROOT);
  const walk = walkModuleGraph(entries, SRC, { stopAtClientBoundary: true });

  it('finds app modules to walk (fails closed on a bad root)', () => {
    expect(entries.length).toBeGreaterThan(50);
  });

  it('actually resolved the graph rather than stopping at the entries', () => {
    // Without this, a resolver that returned `null` for everything would make
    // the reachability assertion below pass vacuously and look like good news.
    // Counting only what lies OUTSIDE `app/` is the part that cannot be
    // satisfied by the entry list itself.
    const beyondEntries = [...walk.parents.keys()].filter(f => !f.startsWith(APP_ROOT + sep));
    expect(beyondEntries.length).toBeGreaterThan(50);
  });

  it('leaves no first-party specifier unresolved', () => {
    // An unresolvable `@/` or relative specifier is a branch of the graph this
    // walk never entered — a hole, not a non-event. If this fires, either an
    // import is genuinely broken or the resolver has met a form it does not
    // know; both need looking at before the assertion below means anything.
    const misses = walk.unresolved.map(([file, spec]) => `${rel(file)} → ${spec}`);
    expect([...new Set(misses)]).toEqual([]);
  });

  it('stops at the client boundary rather than for want of anything to walk', () => {
    // The `'use client'` stop is the difference between a guard and a green
    // light: walk the same entries without it and the handlers ARE reached,
    // through `app/page.tsx` → a client component → `chatStore` → `executor`.
    // So a bug that made every module look like a boundary would empty the
    // walk and quietly pass. This asserts the stop is discriminating — that the
    // clean run above is a fact about the server graph, not about the walk
    // giving up.
    const unbounded = walkModuleGraph(entries, SRC);

    expect(unbounded.parents.size).toBeGreaterThan(walk.parents.size);
    expect([...unbounded.parents.keys()].filter(isHandler).length).toBeGreaterThan(0);
  });

  it('never imports a chat handler, at any depth', () => {
    const reached = [...walk.parents.keys()].filter(isHandler);
    const chains = reached.map(file => chainTo(file, walk.parents).map(rel).join('\n    → '));

    expect(
      chains,
      'A server module now reaches lib/chat/handlers, where most modules ' +
        'value-import a Zustand store. That drags client-only React state into ' +
        'a React Server Component graph and fails `next build`. Take the value ' +
        'through a parameter instead of importing the handler module — a ' +
        'function carries no module edge.',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The guard's own guard.
//
// The failure mode of a tripwire is that it silently stops tripping, and a
// reachability assertion is the easy kind to break: anything that makes the
// walk stop early turns a real violation into a green run. Rather than trust
// the walk, point it at a module that provably DOES reach the handlers and
// require it to say so — transitively, which is the property under test.
// ---------------------------------------------------------------------------

describe('the reachability walk itself', () => {
  const walk = walkModuleGraph([EXECUTOR], SRC);
  const handlers = [...walk.parents.keys()].filter(isHandler);

  it('reports a handler as reachable from the executor that imports them', () => {
    expect(handlers.length).toBeGreaterThan(0);
    expect(chainTo(handlers[0]!, walk.parents)[0]).toBe(EXECUTOR);
  });

  it('follows edges past the first hop', () => {
    // A walk that never enqueued its discoveries — one deleted `queue.push`
    // away — still satisfies every depth-1 assertion in this file. Requiring a
    // chain longer than `entry → direct import` is what that mutation cannot
    // survive.
    const deepest = Math.max(...handlers.map(f => chainTo(f, walk.parents).length));
    expect(deepest).toBeGreaterThan(2);
  });

  it('reports store imports reached THROUGH a handler, not just beside one', () => {
    // The premise of this whole file. Counting stores anywhere in the walk
    // would be satisfied by `executor.ts`'s own `@/stores/editorStore` import
    // and would stay green with every handler store edge deleted, so the chain
    // has to be inspected. If this fires, the handlers have become server-safe
    // and the guard above is no longer load-bearing.
    const throughHandler = [...walk.parents.keys()]
      .filter(isStore)
      .filter(store => chainTo(store, walk.parents).some(isHandler));

    expect(throughHandler.length).toBeGreaterThan(0);
  });

  it('collects a first-party specifier that resolves to nothing', () => {
    // `unresolved` is the mechanism behind the hole-detector above, and it is
    // the one path the real graph never exercises — precisely the kind of code
    // that rots unnoticed.
    const dir = mkdtempSync(join(tmpdir(), 'import-scanner-'));
    const entry = join(dir, 'entry.ts');
    writeFileSync(entry, "import { a } from '@/lib/definitely/not/here';\n");

    expect(walkModuleGraph([entry], SRC).unresolved).toEqual([
      [entry, '@/lib/definitely/not/here'],
    ]);
  });
});

describe('importScanner edge extraction', () => {
  const EDGES: Array<[string, string[]]> = [
    ["import { a } from '@/lib/a';", ['@/lib/a']],
    ['export * from "./b";', ['./b']],
    ["import '@/lib/side-effect';", ['@/lib/side-effect']],
    ["const m = await import('@/lib/c');", ['@/lib/c']],
    ["import('@/lib/d').then(m => m.go());", ['@/lib/d']],
    ["const e = require('@/lib/e');", ['@/lib/e']],
    ["import { a } from 'react';", ['react']],
    // Prettier's wrap for a long dynamic import. The repo ships this form in
    // `lib/engine/loadPlayEngine.ts`; a per-line scan matched neither half and
    // reported no edge AND no unresolved miss.
    ["const m = await import(\n  '@/lib/f'\n);", ['@/lib/f']],
    ["import { a } from\n  '@/lib/g';", ['@/lib/g']],
    // Turbopack resolves a static template literal like any other specifier.
    ['const m = await import(`@/lib/h`);', ['@/lib/h']],
  ];

  const ERASED: string[] = [
    "import type { A } from '@/lib/a';",
    "export type { A } from '@/lib/a';",
    "  loader: (c: C) => import('@/lib/a').Result;",
  ];

  it.each(EDGES)('reads %s as a runtime edge', (source, expected) => {
    expect(extractSpecifiers(source)).toEqual(expected);
  });

  it.each(ERASED)('reads %s as carrying no edge', source => {
    expect(extractSpecifiers(source)).toEqual([]);
  });

  it('keeps a live import sharing a line with a type-only one', () => {
    // Dropping the whole line on the leading `import type` erased the second,
    // real edge.
    const line = "import type { A } from '@/lib/a'; import { b } from '@/lib/b';";
    const found = extractStatements(stripComments(line)).flatMap(extractSpecifiers);

    expect(found).toEqual(['@/lib/b']);
  });

  it('treats a member access off a bare assignment as a runtime edge', () => {
    // `= import('…').default` evaluates the module; only `:` and `=>` put it in
    // type position.
    expect(extractSpecifiers("const g = import('@/lib/a').default;")).toEqual(['@/lib/a']);
  });

  it('separates first-party specifiers from packages', () => {
    expect(isInternalSpecifier('@/lib/a')).toBe(true);
    expect(isInternalSpecifier('./a')).toBe(true);
    expect(isInternalSpecifier('next/server')).toBe(false);
  });

  it('resolves an alias, a relative path and a directory index', () => {
    expect(resolveSpecifier('@/lib/chat/executor', EXECUTOR, SRC)).toBe(EXECUTOR);
    expect(resolveSpecifier('./executor', EXECUTOR, SRC)).toBe(EXECUTOR);
    // `lib/chat/handlers/` has no barrel; `lib/game-creation/` does, and a
    // directory specifier landing on its `index.ts` is the form that carries
    // most of the depth in this graph.
    expect(resolveSpecifier('@/lib/game-creation', EXECUTOR, SRC)).toBe(
      join(SRC, 'lib', 'game-creation', 'index.ts'),
    );
  });

  it('returns null for a package and for a first-party path that is not there', () => {
    // The second case is what `walk.unresolved` collects; conflating it with
    // "package, nothing to walk" is how a hole in the graph goes unnoticed.
    expect(resolveSpecifier('next/server', EXECUTOR, SRC)).toBeNull();
    expect(resolveSpecifier('@/lib/chat/nope', EXECUTOR, SRC)).toBeNull();
  });

  it('reports no chain for a file the walk never reached', () => {
    expect(chainTo('/nowhere.ts', new Map())).toEqual([]);
  });
});
