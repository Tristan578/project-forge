/**
 * Unit tests for the substitution-naming rules in `../substitution.ts` (#10158).
 *
 * Every rule is driven with a SYNTHETIC listing in the shape Playwright's JSON
 * reporter emits for `playwright test --list --reporter=json`, so each way the
 * check can fail is shown failing. The real-Playwright end of the contract —
 * that a describe-level annotation actually reaches its tests in that listing —
 * is exercised by `scripts/__tests__/check-substitution-naming.test.ts`, which
 * lists synthetic spec files with the real CLI (lesson #14: a hand-built input
 * only proves what the checker does with the shape you believed).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  SUBSTITUTION_ANNOTATION_TYPE,
  checkSubstitutionNaming,
  collectListedTests,
  formatSubstitutionProblems,
  listSpecFiles,
  sourceDeclaresSubstitution,
  substitutionMarker,
  type Listing,
  type ListingAnnotation,
  type ListingSpec,
  type ListingSuite,
} from '../substitution';

const sub = (description: string, type = SUBSTITUTION_ANNOTATION_TYPE): ListingAnnotation => ({
  type,
  description,
});

/** One spec as the JSON reporter lists it: one `tests[]` entry per project. */
function spec(
  title: string,
  annotations: ListingAnnotation[] = [],
  { file = 'tests/synthetic.spec.ts', line = 10, projects = 1 } = {},
): ListingSpec {
  return {
    title,
    file,
    line,
    tests: Array.from({ length: projects }, () => ({ annotations })),
  };
}

function describeSuite(title: string, specs: ListingSpec[], suites: ListingSuite[] = []): ListingSuite {
  return { title, file: 'tests/synthetic.spec.ts', specs, suites };
}

/** The file-level suite: its title is the file path, which is not part of a test's title. */
function fileSuite(file: string, specs: ListingSpec[], suites: ListingSuite[] = []): ListingSuite {
  return { title: file.replace(/\//g, '\\'), file, specs, suites };
}

function listing(suites: ListingSuite[], errors: Listing['errors'] = []): Listing {
  return { config: { rootDir: '/repo/web/e2e' }, suites, errors };
}

describe('substitutionMarker', () => {
  it('spells the marker the title must carry', () => {
    expect(substitutionMarker('AI generation')).toBe('[substituted: AI generation]');
  });
});

describe('collectListedTests', () => {
  it('builds the full title from nested describes and leaves the file suite title out', () => {
    const tests = collectListedTests(
      listing([
        fileSuite('tests/synthetic.spec.ts', [spec('top level')], [
          describeSuite('Outer', [spec('in outer')], [describeSuite('Inner', [spec('in inner')])]),
        ]),
      ]),
    );
    expect(tests.map((t) => t.fullTitle)).toEqual([
      'top level',
      'Outer › in outer',
      'Outer › Inner › in inner',
    ]);
    expect(tests.every((t) => t.file === 'tests/synthetic.spec.ts')).toBe(true);
  });

  it('collapses one spec listed under several projects into one test, deduplicating its annotations', () => {
    const tests = collectListedTests(
      listing([fileSuite('tests/a.spec.ts', [spec('t [substituted: X]', [sub('X')], { projects: 3 })])]),
    );
    expect(tests).toHaveLength(1);
    expect(tests[0].annotations).toEqual([sub('X')]);
  });

  it('normalises Windows separators in the file path', () => {
    const tests = collectListedTests(listing([fileSuite('tests\\win.spec.ts', [spec('t', [], { file: 'tests\\win.spec.ts' })])]));
    expect(tests[0].file).toBe('tests/win.spec.ts');
  });
});

describe('checkSubstitutionNaming on synthetic listings (the check can fail)', () => {
  it('passes a listing where every annotation has its marker and every marker its annotation', () => {
    const report = checkSubstitutionNaming(
      listing([
        fileSuite('tests/honest.spec.ts', [
          spec('drives the real engine', [], { file: 'tests/honest.spec.ts' }),
          spec('spawns via store [substituted: WASM engine]', [sub('WASM engine')], { file: 'tests/honest.spec.ts', line: 20 }),
        ]),
      ]),
    );
    expect(report.problems).toEqual([]);
    expect(report.testCount).toBe(2);
    expect(report.specFiles).toEqual(['tests/honest.spec.ts']);
    expect(report.substitutedFiles).toEqual(['tests/honest.spec.ts']);
    expect(report.substitutedTestCount).toBe(1);
  });

  it('FAILS an annotated test whose title lacks the marker, naming the file, line and test', () => {
    const report = checkSubstitutionNaming(
      listing([fileSuite('tests/synthetic.spec.ts', [spec('AI builds a level', [sub('AI generation')], { line: 42 })])]),
    );
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatchObject({ file: 'tests/synthetic.spec.ts', line: 42, test: 'AI builds a level' });
    expect(report.problems[0].reason).toContain('[substituted: AI generation]');
    expect(formatSubstitutionProblems(report.problems)).toContain('tests/synthetic.spec.ts:42 › AI builds a level');
  });

  it('accepts a marker on an enclosing describe, which is part of every child test full title', () => {
    const report = checkSubstitutionNaming(
      listing([
        fileSuite('tests/journey.spec.ts', [], [
          describeSuite('Gate [substituted: AI generation] @journey', [
            // The JSON reporter copies a describe annotation onto each test in it.
            spec('first', [sub('AI generation')], { file: 'tests/journey.spec.ts' }),
            spec('second', [sub('AI generation')], { file: 'tests/journey.spec.ts', line: 20 }),
          ]),
        ]),
      ]),
    );
    expect(report.problems).toEqual([]);
    expect(report.substitutedTestCount).toBe(2);
  });

  it('FAILS a title that carries the marker without the annotation', () => {
    const report = checkSubstitutionNaming(
      listing([fileSuite('tests/synthetic.spec.ts', [spec('claims [substituted: AI generation]')])]),
    );
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0].reason).toMatch(/carries \[substituted: AI generation\] but no substitution annotation/);
    // A marker alone does not make the file count as substituted: only the annotation does.
    expect(report.substitutedFiles).toEqual([]);
  });

  it('FAILS both directions when the marker names a different component than the annotation', () => {
    const report = checkSubstitutionNaming(
      listing([fileSuite('tests/synthetic.spec.ts', [spec('t [substituted: WASM engine]', [sub('AI generation')])])]),
    );
    expect(report.problems.map((p) => p.reason)).toEqual([
      expect.stringContaining('lacks [substituted: AI generation]'),
      expect.stringContaining('carries [substituted: WASM engine] but no substitution annotation'),
    ]);
  });

  it('requires one marker per declared component', () => {
    const report = checkSubstitutionNaming(
      listing([
        fileSuite('tests/synthetic.spec.ts', [
          spec('t [substituted: AI generation]', [sub('AI generation'), sub('WASM engine')]),
        ]),
      ]),
    );
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0].reason).toContain('lacks [substituted: WASM engine]');
  });

  it('FAILS a malformed marker instead of ignoring it', () => {
    for (const title of ['t [Substituted: X]', 't [substituted:X]', 't [substituted:  X]', 't [substitution: X]']) {
      const report = checkSubstitutionNaming(listing([fileSuite('tests/s.spec.ts', [spec(title, [sub('X')])])]));
      expect(
        report.problems.some((p) => p.reason.includes('malformed')),
        `${title} should be reported as malformed`,
      ).toBe(true);
    }
  });

  it('FAILS a substitution annotation with no component, or one a marker cannot spell', () => {
    for (const description of ['', '   ', 'a]b']) {
      const report = checkSubstitutionNaming(listing([fileSuite('tests/s.spec.ts', [spec('t', [sub(description)])])]));
      expect(report.problems.length, `description ${JSON.stringify(description)}`).toBeGreaterThan(0);
    }
    const missing = checkSubstitutionNaming(
      listing([fileSuite('tests/s.spec.ts', [spec('t', [{ type: SUBSTITUTION_ANNOTATION_TYPE }])])]),
    );
    expect(missing.problems[0].reason).toMatch(/names no component/);
  });

  it('FAILS an annotation type that is a near miss for substitution, which would silently declare nothing', () => {
    for (const type of ['substituted', 'Substitution', 'substitutions']) {
      const report = checkSubstitutionNaming(listing([fileSuite('tests/s.spec.ts', [spec('t [substituted: X]', [sub('X', type)])])]));
      expect(
        report.problems.some((p) => p.reason.includes(`"${type}"`)),
        `annotation type ${type}`,
      ).toBe(true);
    }
  });

  it('ignores unrelated annotations', () => {
    const report = checkSubstitutionNaming(
      listing([fileSuite('tests/s.spec.ts', [spec('t', [{ type: 'issue', description: '#1' }, { type: 'slow' }])])]),
    );
    expect(report.problems).toEqual([]);
  });

  it('FAILS when the listing finds zero specs instead of passing vacuously', () => {
    const report = checkSubstitutionNaming(listing([]));
    expect(report.testCount).toBe(0);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0].reason).toMatch(/zero specs/);
  });

  it('FAILS a listing that reports load errors, such as Playwright\'s "No tests found"', () => {
    const report = checkSubstitutionNaming(listing([], [{ message: 'Error: No tests found' }]));
    expect(report.problems.map((p) => p.reason)).toEqual([
      expect.stringContaining('No tests found'),
      expect.stringMatching(/zero specs/),
    ]);
  });

  it('FAILS a file suite that lists no tests at all', () => {
    const report = checkSubstitutionNaming(listing([fileSuite('tests/empty.spec.ts', [])]));
    expect(report.problems[0].reason).toMatch(/zero specs/);
  });
});

describe('sourceDeclaresSubstitution (the static form the capability-matrix gate scans for)', () => {
  it('recognises the literal annotation on a test or a describe', () => {
    expect(sourceDeclaresSubstitution(`test('t', { annotation: { type: 'substitution', description: 'X' } }, () => {});`)).toBe(true);
    expect(sourceDeclaresSubstitution(`test.describe('d', {\n  annotation: [\n    { type: "substitution", description: 'X' },\n  ],\n}, () => {});`)).toBe(true);
  });

  it('does not count a commented-out declaration', () => {
    expect(sourceDeclaresSubstitution(`// annotation: { type: 'substitution', description: 'X' }\ntest('t', () => {});`)).toBe(false);
    expect(sourceDeclaresSubstitution(`/*\n * { type: 'substitution' }\n */\ntest('t', () => {});`)).toBe(false);
  });

  it('does not see a declaration built from a constant — the listing cross-check rejects that form', () => {
    expect(sourceDeclaresSubstitution(`const KIND = 'substitution';\ntest('t', { annotation: { type: KIND, description: 'X' } }, () => {});`)).toBe(false);
  });
});

describe('listSpecFiles', () => {
  const root = mkdtempSync(join(tmpdir(), 'substitution-spec-files-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('walks nested directories for *.spec.ts and skips node_modules', () => {
    mkdirSync(join(root, 'tests', 'deep'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'tests', 'a.spec.ts'), '');
    writeFileSync(join(root, 'tests', 'deep', 'b.spec.ts'), '');
    writeFileSync(join(root, 'tests', 'helper.ts'), '');
    writeFileSync(join(root, 'tests', 'c.test.ts'), '');
    writeFileSync(join(root, 'node_modules', 'pkg', 'd.spec.ts'), '');
    const found = listSpecFiles(root).map((f) => relative(root, f).replace(/\\/g, '/'));
    expect(found).toEqual(['tests/a.spec.ts', 'tests/deep/b.spec.ts']);
  });

  it('returns nothing for a missing directory, which callers must treat as a failure', () => {
    expect(listSpecFiles(join(root, 'does-not-exist'))).toEqual([]);
  });
});
