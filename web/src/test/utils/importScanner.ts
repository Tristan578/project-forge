/**
 * Shared machinery for the RSC-boundary tests that read the module graph off
 * disk rather than off a bundler.
 *
 * Two tests depend on this:
 *
 *   - `lib/game-creation/__tests__/serverSafeImports.test.ts` walks outward from
 *     every API route and refuses client-only first-party source.
 *   - `lib/chat/__tests__/apiHandlerReachability.test.ts` walks outward from
 *     every server-rendered module under `app/` and asserts none of them can
 *     reach `lib/chat/handlers`.
 *
 * Both need the same primitives — strip comments, decide whether an occurrence
 * survives compilation, resolve a specifier to a file — and both are guarding a
 * failure mode whose signature is that the guard silently stops tripping. A
 * second hand-rolled copy of the comment stripper is exactly how that happens,
 * so there is one copy and both callers import it.
 *
 * Everything here is TEXTUAL. It sees the import forms this codebase writes; it
 * does not see an alias laundered through a third module, a specifier assembled
 * at runtime, or a `tsconfig` path mapping other than `@/*`. `next build`
 * remains the authority — these are tripwires for regressions that actually
 * happened, priced at milliseconds instead of minutes.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Directory names never walked: their contents are not shipped code. */
const SKIPPED_DIRS = new Set(['__tests__', '__mocks__', 'node_modules']);

/**
 * Test files sitting beside the module they cover. They are not shipped, so
 * including them as walk ENTRIES is a false-FAIL waiting to happen: a route
 * test that legitimately imports a client-only module to mock it would redden a
 * guard about the production graph.
 */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Recursively collect every shipped `.ts`/`.tsx` source file under `dir`. */
export function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !TEST_FILE.test(entry.name)
    ) {
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
 *
 * KNOWN RESIDUAL, left alone deliberately. A regex literal containing `/*`
 * (`/[a-z]\/*x/`) reads as the start of a block comment, and the stripper then
 * blanks lines until it finds a terminator — the false-PASS direction. The
 * obvious fix, deciding regex-vs-comment from the preceding character, was
 * tried and reverted: `;` and `{` precede both a regex literal and an ordinary
 * docblock, so the heuristic turned real docblocks into scanned text and
 * reported a prose mention of `@/stores/editorStore` as a violation. Trading a
 * live false-FAIL for a hypothetical false-PASS is a bad deal for a tripwire
 * nobody can silence. Telling the two apart needs a real tokenizer, and the
 * honest scope of this file is textual. `web/src` currently contains no such
 * regex literal.
 */
export function stripComments(source: string): string[] {
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
 * type-only is reported. `await import('…')` and a bare `import x from '…'`
 * both fall through to the failure path, which is the point.
 *
 * The type-position test requires member ACCESS, not a call, and requires the
 * `import(` to sit after `:` or `=>` — the two places a TYPE can appear.
 * `import('…').Foo` names a type; `import('…').then(m => m.useEditorStore)` is a
 * runtime load wearing the same first few characters, and an earlier version of
 * this function waved it through. So is `const g = import('…').default`, which
 * is why a bare `=` is NOT accepted here — only `=>`. The `\b` before the
 * lookahead is load-bearing: it stops the identifier match backtracking off
 * `then` onto `the` and satisfying the "not followed by `(`" test one character
 * early.
 */
export function isTypeOnlyOccurrence(statement: string): boolean {
  if (/^\s*import\s+type\s/.test(statement)) return true;
  if (/^\s*export\s+type\s/.test(statement)) return true;
  // Anything that evaluates the module is a real edge, whatever shape it wears.
  if (/\bawait\s/.test(statement) || /\.then\s*\(/.test(statement)) return false;
  // `=> import('@/hooks/useEngine').BatchResult` / `: import('…').Foo`
  if (/(?::|=>)\s*import\((['"])[^'"]+\1\)\s*\.[A-Za-z_$][\w$]*\b\s*(?!\()/.test(statement)) {
    return true;
  }
  return false;
}

/**
 * Split comment-stripped source into statements.
 *
 * Statements, not physical lines, are the unit — two independent false-PASS
 * holes turn on the difference:
 *
 *   1. Prettier wraps any `await import('…')` whose path pushes the line past
 *      the print width, and the repo already ships that form
 *      (`lib/engine/loadPlayEngine.ts`, among others). A per-line scan sees the
 *      `import(` and the quoted specifier on different lines, matches neither,
 *      and records no edge AND no unresolved miss — a real violation reported
 *      as clean.
 *   2. `import type { A } from '@/a'; import { B } from '@/b';` on one physical
 *      line is type-only by a per-line test, which erases the live second edge.
 *
 * Splitting on `;` assumes semicolons, which Prettier guarantees here. Two
 * statements sharing a segment (ASI style) would restore hole 2 for that
 * segment alone; nothing in `web/src` writes that.
 */
export function extractStatements(strippedLines: string[]): string[] {
  return strippedLines.join('\n').split(';');
}

/**
 * Every module specifier in a statement that survives compilation.
 *
 * Covers the forms this codebase writes — `from '…'`, a side-effect
 * `import '…'`, `import('…')`, `require('…')` — and drops the statement
 * entirely when `isTypeOnlyOccurrence` proves it erased. `\s*` matches
 * newlines, so a wrapped specifier is found as long as the caller passes a
 * statement rather than a line.
 *
 * Backticks are in the quote class because Turbopack resolves a static template
 * literal exactly like a quoted one. An INTERPOLATED template resolves to
 * nothing on disk and is reported as unresolved, which is the honest answer: a
 * runtime-assembled specifier is a branch this walk cannot follow.
 */
export function extractSpecifiers(statement: string): string[] {
  if (isTypeOnlyOccurrence(statement)) return [];
  const out: string[] = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"`])([^'"`]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(statement)) !== null) {
    out.push(match[2]!);
  }
  return out;
}

/** Extensions tried, in order, when a specifier omits one. */
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.json', '.d.ts'];

/**
 * Resolve an internal specifier to a file on disk.
 *
 * Returns `null` for a bare package specifier (`react`, `next/server`): those
 * live in `node_modules` and cannot reach first-party source, so walking them
 * would only cost time. Returns `null` too when nothing on disk matches, which
 * the callers surface rather than swallow — an unresolvable `@/` or relative
 * specifier is a hole in the walk, not a non-event.
 */
export function resolveSpecifier(
  specifier: string,
  fromFile: string,
  srcRoot: string,
): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = join(srcRoot, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    return null; // bare package — outside first-party source by construction
  }

  const candidates = [base, ...EXTENSIONS.map(ext => base + ext)];
  for (const ext of EXTENSIONS) candidates.push(join(base, `index${ext}`));

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** True when `specifier` names first-party source rather than a package. */
export function isInternalSpecifier(specifier: string): boolean {
  return specifier.startsWith('@/') || specifier.startsWith('.');
}

/**
 * True when the file opens with a `'use client'` directive.
 *
 * Such a module IS the client boundary: a server component may import it, and
 * everything it reaches is legitimately client code. A walk asking "what does
 * the SERVER graph pull in" must stop here, or it reports every ordinary
 * server-renders-a-client-component edge as a violation.
 */
export function isClientBoundary(file: string): boolean {
  for (const line of stripComments(readFileSync(file, 'utf8'))) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    return /^(['"])use client\1/.test(trimmed);
  }
  return false;
}

export interface ModuleGraphWalk {
  /** Every file reached, mapped to the file that first imported it. */
  parents: Map<string, string | null>;
  /** `[importingFile, specifier]` pairs that named source but matched nothing. */
  unresolved: Array<[string, string]>;
}

export interface WalkOptions {
  /**
   * Record a `'use client'` module but do not follow its imports. Correct for
   * any walk asking what the SERVER graph pulls in.
   */
  stopAtClientBoundary?: boolean;
}

/**
 * Breadth-first walk of the runtime import graph starting from `entries`.
 *
 * Breadth-first is what makes the reported chains short: the first path found
 * to a file is a shortest one, so a failure names the most direct route in
 * rather than whichever branch the recursion happened to descend.
 */
export function walkModuleGraph(
  entries: string[],
  srcRoot: string,
  options: WalkOptions = {},
): ModuleGraphWalk {
  const parents = new Map<string, string | null>();
  const unresolved: Array<[string, string]> = [];
  const queue: string[] = [];

  for (const entry of entries) {
    if (parents.has(entry)) continue;
    parents.set(entry, null);
    queue.push(entry);
  }

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (!/\.(ts|tsx|mts|js|jsx)$/.test(file)) continue; // JSON and friends are leaves
    if (options.stopAtClientBoundary && isClientBoundary(file)) continue;

    for (const statement of extractStatements(stripComments(readFileSync(file, 'utf8')))) {
      for (const specifier of extractSpecifiers(statement)) {
        if (!isInternalSpecifier(specifier)) continue;
        const target = resolveSpecifier(specifier, file, srcRoot);
        if (target === null) {
          unresolved.push([file, specifier]);
          continue;
        }
        if (parents.has(target)) continue;
        parents.set(target, file);
        queue.push(target);
      }
    }
  }

  return { parents, unresolved };
}

/**
 * Reconstruct the import chain from an entry point down to `file`, oldest
 * first. Returns `[]` when `file` was never reached.
 */
export function chainTo(file: string, parents: Map<string, string | null>): string[] {
  if (!parents.has(file)) return [];
  const chain: string[] = [];
  let cursor: string | null | undefined = file;
  while (cursor != null) {
    chain.unshift(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return chain;
}
