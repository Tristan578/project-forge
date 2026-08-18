/**
 * Guards the one rule that makes every other dialogue fix hold: nothing outside
 * `dialogueStore.ts` reads the tree map by index.
 *
 * `dialogueTrees` is a plain object keyed by ids that come from persisted JSON,
 * from generated content, and from the chat handlers — so `"__proto__"`,
 * `"constructor"` and `"toString"` are all reachable keys. A bare
 * `dialogueTrees[id]` answers with something off `Object.prototype` for each of
 * them: truthy, so every `if (!tree) return` guard passes, and then
 * `tree.nodes.find(...)` throws. That took down the play-mode overlay and the
 * editor panel (PF-1144), and both call sites looked completely ordinary.
 *
 * `getTree` gates on `Object.hasOwn` and on walkability, so the fix is to route
 * every read through it. This test is what stops the next call site — a new
 * panel, a new handler, a merge that resurrects an old line — from reintroducing
 * the bare form. The failure mode of that class of bug is that it looks correct,
 * so review is not a reliable gate for it; a scan is.
 *
 * Scope, stated honestly: this is textual, so it catches the direct index form,
 * not `const map = trees; map[id]` laundered through a local, and not a
 * destructure. It is a tripwire for the shape that actually shipped, not a proof
 * of the boundary. The store's own guards remain the authority.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from '@/test/utils/importScanner';

const SRC = join(__dirname, '..', '..');

/**
 * The store is where the guarded accessors live, so it is the one file that must
 * index the map directly — `getTree` cannot be implemented in terms of itself.
 */
const STORE = join(SRC, 'stores', 'dialogueStore.ts');

/** Matches `dialogueTrees[...]`, and the `state.`/`get().` prefixed forms. */
const BARE_INDEX = /\bdialogueTrees\s*\[/;

/**
 * The scan itself, over one file's text: returns the 1-indexed lines carrying a
 * bare index read.
 *
 * Split out so it can be driven against a synthetic corpus below. Every defect
 * a matcher like this acquires makes it report FEWER violations, which is the
 * false-PASS direction and is invisible in the suite's own output — a scan that
 * silently stopped matching anything reads exactly like a clean repo.
 */
export function bareIndexLines(source: string): number[] {
  const hits: number[] = [];
  stripComments(source).forEach((line, i) => {
    if (BARE_INDEX.test(line)) hits.push(i + 1);
  });
  return hits;
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'test') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
      && !entry.name.includes('.test.')
      && !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('dialogue tree access', () => {
  const files = collectSourceFiles(SRC);

  it('finds source files to check (fails closed on a bad root)', () => {
    // A mis-pointed root that exists but enumerates nothing would make every
    // assertion below pass vacuously, which is worse than no guard at all.
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(STORE);
  });

  it('nothing outside the store indexes the tree map directly', () => {
    const violations: string[] = [];

    for (const file of files) {
      if (file === STORE) continue;
      const source = readFileSync(file, 'utf8');
      const raw = source.split('\n');
      for (const line of bareIndexLines(source)) {
        violations.push(`${relative(SRC, file)}:${line}: ${raw[line - 1]?.trim() ?? ''}`);
      }
    }

    expect(
      violations,
      'A bare `dialogueTrees[id]` resolves inherited properties for the ids '
        + '"__proto__" / "constructor" / "toString", which are all reachable from '
        + 'persisted and generated data. The result is truthy, so `if (!tree)` '
        + 'passes and the next property read throws. Use `getTree(trees, id)`.',
    ).toEqual([]);
  });

  it('the accessor the rule redirects to still gates on ownership', () => {
    // The rule above is only worth enforcing while `getTree` is actually safer
    // than the form it replaces. If the `Object.hasOwn` gate were ever dropped,
    // every redirected call site would inherit the original bug and this suite
    // would keep reporting green — so the redirect target is pinned, not assumed.
    //
    // Note the store is exempted from the scan by path, not because it needs the
    // banned form: `getTree` reads its own `trees` parameter, and the store's only
    // textual occurrence of `dialogueTrees[` is the doc comment naming the bug.
    // The exemption is there so implementing the accessor never trips the rule the
    // accessor exists to enforce.
    const stripped = stripComments(readFileSync(STORE, 'utf8')).join('\n');

    expect(stripped).toContain('Object.hasOwn(trees, treeId)');
  });

});

// ---------------------------------------------------------------------------
// The scan's own scan.
//
// Every way this matcher can be wrong makes it report FEWER violations, and the
// clean repo above produces the same empty array either way — so "the suite is
// green" carries no information about whether the scan still works. These drive
// it against sources that DO violate the rule, which is the only direction that
// can fail loudly. Living in `__tests__/`, they are outside the walk above and
// cannot trip the scan they describe.
// ---------------------------------------------------------------------------

describe('dialogueTreeAccess scanner', () => {
  const VIOLATIONS = [
    'const tree = dialogueTrees[treeId];',
    'const tree = state.dialogueTrees[activeTreeId];',
    'const tree = useDialogueStore.getState().dialogueTrees[id];',
    'const tree = get().dialogueTrees[id] ?? null;',
    'return dialogueTrees [ treeId ];',
    'if (dialogueTrees[id]) { render(); }',
    "/* eslint-disable-next-line */ const t = state.dialogueTrees[id];",
  ];

  const SAFE = [
    'const tree = getTree(dialogueTrees, treeId);',
    'const trees = listTrees(dialogueTrees);',
    'set({ dialogueTrees: { ...state.dialogueTrees, [treeId]: updated } });',
    'const { dialogueTrees } = useDialogueStore.getState();',
    '// never write dialogueTrees[id] — use getTree',
  ];

  it.each(VIOLATIONS)('reports a bare index read: %s', line => {
    expect(bareIndexLines(line)).toEqual([1]);
  });

  it.each(SAFE)('leaves a guarded or commented line alone: %s', line => {
    expect(bareIndexLines(line)).toEqual([]);
  });

  it('reports the true line number inside a multi-line file', () => {
    // A stripper that dropped comment lines instead of blanking them would still
    // find this violation — and point three lines above it, at whatever innocent
    // code happened to be there.
    const source = [
      '/**',
      ' * dialogueTrees[id] is banned.',
      ' */',
      'const tree = state.dialogueTrees[id];',
    ].join('\n');

    expect(bareIndexLines(source)).toEqual([4]);
  });

  it('leaves the store\'s own doc comment about the banned form alone', () => {
    // Fed as a whole block, not as a bare ` * …` line: a continuation line on its
    // own is not self-identifying as a comment, and this one opens a template
    // literal on its first backtick. That is a property of the fixture, not of a
    // real file — the enclosing `/**` is what makes the strip stateful, and the
    // line-number case above proves the real shape is handled.
    const source = [
      '/**',
      ' * A bare `dialogueTrees[id]` answers `Object.prototype` for the id',
      ' * "__proto__" — truthy, so `if (!tree)` passes and the next read throws.',
      ' */',
      'export function getTree(trees: Record<string, DialogueTree>, treeId: string) {',
    ].join('\n');

    expect(bareIndexLines(source)).toEqual([]);
  });

  it('does not blank a real access following a string containing "//"', () => {
    const source = "const doc = 'https://x.dev'; const t = dialogueTrees[id];";

    expect(bareIndexLines(source)).toEqual([1]);
  });
});
