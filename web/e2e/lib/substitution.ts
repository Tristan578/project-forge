/**
 * Substitution naming for Playwright specs (#10158, epic #9723 criterion 3).
 *
 * WHY THIS EXISTS
 * ---------------
 * A journey that proves a capability by standing something else in for the
 * component it names — store injection in place of the AI, a store setter in
 * place of the WASM engine, a page-local JSON round trip in place of the save
 * server — is a useful test and a false proof. Before this file nothing said so:
 * `journey.spec.ts` documented "No WASM/AI is involved" in a comment while its
 * describe read "Interactive Journey Gate", and `docs/capability-matrix.md`
 * could cite such a spec as the evidence for a `proven` cell.
 *
 * THE CONVENTION
 * --------------
 * A test (or a describe, which Playwright copies onto every test inside it)
 * that substitutes a component declares it twice, in two places that must agree:
 *
 *   1. a static Playwright annotation, written literally:
 *        { annotation: { type: 'substitution', description: '<component>' } }
 *      It is readable from `playwright test --list --reporter=json` without
 *      running anything, and it is what the capability-matrix gate reads.
 *   2. the marker `[substituted: <component>]` in the test's full title (its
 *      own title or an enclosing describe's), so the substitution shows in
 *      every report, log line and grep — not only in metadata.
 *
 * `checkSubstitutionNaming` fails when a test carries the annotation without
 * the marker, carries the marker without the annotation, spells either one
 * almost-but-not-quite right, or when the listing holds zero specs (a check
 * over nothing must not pass — lessons-learned #9). The CLI that feeds it a
 * real listing, and cross-checks the literal form the matrix gate scans for, is
 * `web/scripts/check-substitution-naming.ts`; the CI job that runs it is
 * `test-e2e-journey` in `.github/workflows/ci.yml`.
 *
 * Tags are unaffected: the marker holds no `@`, so a renamed describe keeps
 * exactly the tags — and therefore the @ui/@journey selections — it had.
 */
import type { JSONReport } from '@playwright/test/reporter';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The annotation `type` that declares a substitution. */
export const SUBSTITUTION_ANNOTATION_TYPE = 'substitution';

/** The marker a substituted test's full title must carry for `component`. */
export function substitutionMarker(component: string): string {
  return `[substituted: ${component}]`;
}

/**
 * Anything shaped like a marker, canonical or not: any case, any spacing, and
 * any `substitut…` spelling. Deliberately loose so a near miss is REPORTED as
 * malformed rather than silently read as "no marker here".
 */
const LOOSE_MARKER_RE = /\[\s*substitut\w*\s*:([^\]]*)\]/gi;

/** An annotation type close enough to `substitution` to be a typo of it. */
const NEAR_MISS_TYPE_RE = /^\s*substitut/i;

export interface ListingAnnotation {
  type: string;
  description?: string;
  location?: { file: string; line: number; column: number };
}

export interface ListingSpec {
  title: string;
  file: string;
  line: number;
  /** One entry per project the spec runs under. */
  tests: ReadonlyArray<{ annotations: readonly ListingAnnotation[] }>;
}

export interface ListingSuite {
  title: string;
  file: string;
  specs: readonly ListingSpec[];
  suites?: readonly ListingSuite[];
}

/** The subset of Playwright's JSON report that this check reads. */
export interface Listing {
  config: { rootDir: string };
  suites: readonly ListingSuite[];
  errors: ReadonlyArray<{ message?: string }>;
}

/**
 * Compile-time proof that Playwright's own `JSONReport` satisfies `Listing`:
 * if a Playwright upgrade renames or retypes a field read here, `tsc` fails
 * instead of the check quietly reading `undefined`.
 */
type AssertTrue<T extends true> = T;
export type JsonReportSatisfiesListing = AssertTrue<JSONReport extends Listing ? true : false>;

export interface ListedTest {
  /** Spec file relative to the listing's rootDir, with forward slashes. */
  file: string;
  line: number;
  /** Enclosing describe titles and the test title, joined by ` › `. */
  fullTitle: string;
  annotations: ListingAnnotation[];
}

export interface SubstitutionProblem {
  file: string;
  line: number;
  test: string;
  reason: string;
}

export interface SubstitutionReport {
  /** Distinct spec files the listing holds tests for, sorted. */
  specFiles: string[];
  testCount: number;
  /** Distinct spec files holding at least one substitution-annotated test, sorted. */
  substitutedFiles: string[];
  substitutedTestCount: number;
  problems: SubstitutionProblem[];
}

const toPosix = (path: string) => path.replace(/\\/g, '/');

function dedupeAnnotations(annotations: readonly ListingAnnotation[]): ListingAnnotation[] {
  const seen = new Set<string>();
  const out: ListingAnnotation[] = [];
  for (const annotation of annotations) {
    const key = `${annotation.type}\u0000${annotation.description ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: annotation.type, description: annotation.description });
  }
  return out;
}

/**
 * Flatten a listing into one entry per spec. The file-level suite's title is
 * the file path, so it is left out of the full title; a spec listed under
 * several projects is one test whose annotations are merged.
 */
export function collectListedTests(listing: Listing): ListedTest[] {
  const out: ListedTest[] = [];
  const visit = (suite: ListingSuite, titlePath: string[]) => {
    for (const spec of suite.specs ?? []) {
      out.push({
        file: toPosix(spec.file),
        line: spec.line,
        fullTitle: [...titlePath, spec.title].join(' › '),
        annotations: dedupeAnnotations(spec.tests.flatMap((test) => test.annotations ?? [])),
      });
    }
    for (const child of suite.suites ?? []) visit(child, [...titlePath, child.title]);
  };
  for (const fileSuite of listing.suites ?? []) visit(fileSuite, []);
  return out;
}

function checkTest(test: ListedTest): string[] {
  const reasons: string[] = [];
  const declared = new Set<string>();

  for (const annotation of test.annotations) {
    if (annotation.type !== SUBSTITUTION_ANNOTATION_TYPE) {
      if (NEAR_MISS_TYPE_RE.test(annotation.type)) {
        reasons.push(
          `annotation type "${annotation.type}" is not exactly "${SUBSTITUTION_ANNOTATION_TYPE}", ` +
            'so it declares nothing — spell it exactly',
        );
      }
      continue;
    }
    const component = annotation.description ?? '';
    if (component.trim() === '') {
      reasons.push(
        `a "${SUBSTITUTION_ANNOTATION_TYPE}" annotation names no component — ` +
          `set its description to what the test stands in for, e.g. 'AI generation'`,
      );
      continue;
    }
    if (component !== component.trim() || component.includes(']')) {
      reasons.push(
        `substitution component ${JSON.stringify(component)} cannot be spelled as a title marker ` +
          '(no surrounding whitespace, no "]")',
      );
      continue;
    }
    declared.add(component);
    const marker = substitutionMarker(component);
    if (!test.fullTitle.includes(marker)) {
      reasons.push(
        `annotated as substituting "${component}" but its full title lacks ${marker} — ` +
          'add the marker to the test title or an enclosing describe',
      );
    }
  }

  for (const match of test.fullTitle.matchAll(LOOSE_MARKER_RE)) {
    const raw = match[0];
    const component = match[1].trim();
    const canonical = substitutionMarker(component);
    if (raw !== canonical) {
      reasons.push(`malformed marker ${raw} — write it exactly as ${canonical}`);
      continue;
    }
    if (!declared.has(component)) {
      reasons.push(
        `title carries ${canonical} but no substitution annotation declares "${component}" — ` +
          `add { annotation: { type: '${SUBSTITUTION_ANNOTATION_TYPE}', description: '${component}' } }`,
      );
    }
  }

  return reasons;
}

/** Apply the substitution-naming rules to a `playwright test --list --reporter=json` listing. */
export function checkSubstitutionNaming(listing: Listing): SubstitutionReport {
  const problems: SubstitutionProblem[] = [];
  for (const error of listing.errors ?? []) {
    problems.push({
      file: '(listing)',
      line: 0,
      test: '',
      reason: `Playwright reported a listing error, so some specs are missing from it: ${error.message ?? '(no message)'}`,
    });
  }

  const tests = collectListedTests(listing);
  if (tests.length === 0) {
    problems.push({
      file: '(listing)',
      line: 0,
      test: '',
      reason:
        'the listing found zero specs — a broken glob or config path lists nothing, and a check over nothing must not pass',
    });
  }

  const substitutedFiles = new Set<string>();
  let substitutedTestCount = 0;
  for (const test of tests) {
    if (test.annotations.some((a) => a.type === SUBSTITUTION_ANNOTATION_TYPE)) {
      substitutedFiles.add(test.file);
      substitutedTestCount += 1;
    }
    for (const reason of checkTest(test)) {
      problems.push({ file: test.file, line: test.line, test: test.fullTitle, reason });
    }
  }

  return {
    specFiles: [...new Set(tests.map((t) => t.file))].sort(),
    testCount: tests.length,
    substitutedFiles: [...substitutedFiles].sort(),
    substitutedTestCount,
    problems,
  };
}

export function formatSubstitutionProblems(problems: readonly SubstitutionProblem[]): string {
  return problems
    .map((p) => (p.test ? `  ${p.file}:${p.line} › ${p.test}: ${p.reason}` : `  ${p.file}: ${p.reason}`))
    .join('\n');
}

/**
 * The literal declaration the capability-matrix gate scans spec sources for.
 * The CLI cross-checks it against the listing, so a declaration written any
 * other way (built from a constant, say) fails CI instead of hiding from the
 * matrix gate.
 */
const DECLARATION_SOURCE_RE = /\btype:\s*(['"])substitution\1/;

/** True when a spec's source declares a substitution in the literal form, ignoring comments. */
export function sourceDeclaresSubstitution(source: string): boolean {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return DECLARATION_SOURCE_RE.test(withoutComments);
}

/** Every `*.spec.ts` under `dir` (absolute paths, sorted), skipping node_modules. Empty when `dir` is missing. */
export function listSpecFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(join(current, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
        out.push(join(current, entry.name));
      }
    }
  };
  walk(dir);
  return out.sort();
}
