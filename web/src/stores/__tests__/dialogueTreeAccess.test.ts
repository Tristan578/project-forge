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
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
      // `.spec.` is exempt from the lint rule (PF-1151's
      // `src/**/*.{test,spec}.{ts,tsx}`), so the scan has to skip it too or the
      // two mechanisms disagree the moment anyone adds a `.spec.` file: policed
      // here, exempt there. There are none in the tree today, which is exactly
      // why this was easy to miss.
      && !entry.name.includes('.spec.')
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

// ---------------------------------------------------------------------------
// The scan and the lint rule must agree about scope.
//
// PF-1151 / #9241 added `spawnforge/no-bare-dialogue-tree-index`, which enforces
// this same boundary against the AST as you type. Two mechanisms enforcing one
// rule is deliberate — they catch different things, see the rule's own comment —
// but two independently-maintained EXEMPTION lists is not: the moment they
// drift, a file is exempt from one and policed by the other, and which one you
// believe depends on where you happened to look.
//
// So the config's list is the single source of truth and these tests pin it.
// Adding an exemption there without teaching the scan about it fails here.
// ---------------------------------------------------------------------------

describe('dialogue tree access — lint rule / scan agreement', () => {
  const CONFIG = readFileSync(join(SRC, '..', 'eslint.config.mjs'), 'utf8');

  /**
   * The exemptions this scan's own scope corresponds to. Keep in the order the
   * config declares them; the comparison below is order-sensitive on purpose,
   * so a reordered list is a deliberate edit rather than a silent one.
   */
  const EXPECTED_EXEMPTIONS = [
    'src/stores/dialogueStore.ts',
    'src/**/__tests__/**',
    'src/**/test/**',
    'src/**/*.{test,spec}.{ts,tsx}',
  ];

  it('registers the rule in the local plugin', () => {
    expect(
      CONFIG,
      'The rule is defined but never added to localPlugin.rules, so ESLint would '
        + 'reject the config or silently never run it.',
    ).toMatch(/'no-bare-dialogue-tree-index':\s*noBareDialogueTreeIndex/);
  });

  it('enables the rule as an error over src/**', () => {
    expect(CONFIG).toMatch(/'spawnforge\/no-bare-dialogue-tree-index':\s*'error'/);
  });

  it('does not enforce the rule through no-restricted-syntax', () => {
    // Flat config resolves rules by NAME. A third `no-restricted-syntax` block
    // overlapping `src/**` would REPLACE the getDb block's entry rather than
    // merge with it, silently disabling that rule — a regression with no
    // symptom. The dedicated rule name is what avoids it, so it is pinned.
    expect(
      CONFIG,
      'dialogueTrees enforcement moved into a no-restricted-syntax block. That '
        + 'shadows the getDb rule for every file both blocks match.',
    ).not.toMatch(/selector:\s*["'][^"']*dialogueTrees/);
  });

  it('exempts exactly the files this scan also skips', () => {
    const block = /const DIALOGUE_TREE_INDEX_EXEMPT = \[([\s\S]*?)\];/.exec(CONFIG);
    expect(block, 'DIALOGUE_TREE_INDEX_EXEMPT not found in eslint.config.mjs').not.toBeNull();

    const declared = [...(block?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);

    expect(
      declared,
      'The lint rule\'s exemption list changed. Reconcile it with this scan\'s '
        + 'scope (collectSourceFiles skips __tests__/test dirs and *.test.* files; '
        + 'the store is skipped explicitly) and update EXPECTED_EXEMPTIONS here — '
        + 'do not just re-pin the number.',
    ).toEqual(EXPECTED_EXEMPTIONS);
  });

  it('the walk skips every exempt shape, including ones absent from the tree', () => {
    // Driven against a synthetic corpus rather than the real tree. `src/` has no
    // `.spec.` file today, so asserting "the walk returned no .spec. files" over
    // the real tree passes whether or not the filter exists — which is how the
    // `.spec.` gap got here in the first place: the lint rule exempted it, the
    // walk did not, and nothing could tell.
    const root = mkdtempSync(join(tmpdir(), 'dta-'));
    try {
      mkdirSync(join(root, '__tests__'));
      mkdirSync(join(root, 'test'));
      mkdirSync(join(root, 'nested'));
      const files = [
        'keep.ts',
        'keep.tsx',
        'nested/keep.ts',
        'skip.test.ts',
        'skip.spec.ts',
        'skip.spec.tsx',
        'skip.d.ts',
        'skip.js',
        '__tests__/skip.ts',
        'test/skip.ts',
      ];
      for (const f of files) writeFileSync(join(root, f), '// fixture\n');

      const walked = collectSourceFiles(root)
        .map((f) => relative(root, f).replace(/\\/g, '/'))
        .sort();

      expect(walked).toEqual(['keep.ts', 'keep.tsx', 'nested/keep.ts']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('the scan really does skip everything the rule exempts', () => {
    // The pin above compares two lists of strings, which proves nothing on its
    // own about what the scan does. This drives the scan's actual file walk and
    // asserts its scope matches the exemptions, so the two cannot agree on
    // paper while diverging in behaviour.
    const walked = collectSourceFiles(SRC).map((f) => relative(SRC, f).replace(/\\/g, '/'));

    expect(walked.filter((f) => f.split('/').includes('__tests__'))).toEqual([]);
    expect(walked.filter((f) => f.split('/').includes('test'))).toEqual([]);
    expect(walked.filter((f) => /\.(test|spec)\.tsx?$/.test(f))).toEqual([]);

    // The store is the one exemption the walk does NOT implement by skipping the
    // file — it is collected and then skipped inside the violation loop, so it
    // stays available for the `Object.hasOwn` pin above. Both mechanisms exempt
    // it; they just do it in different places, and that is worth stating.
    expect(walked).toContain('stores/dialogueStore.ts');
  });
});
