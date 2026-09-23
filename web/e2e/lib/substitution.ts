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
 * over nothing must not pass — lessons-learned #9). "Almost right" means an
 * annotation type, or a marker word, that begins with `substitut` in any case
 * or is within two typos of `substitution`/`substituted` (`substituion`); for
 * the marker it also means a missing or respaced colon, the wrong brackets, a
 * missing `]`, or the word placed later inside the brackets — see
 * `findMarkerAttempts`. The CLI that feeds it a
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

/** The words a declaration is spelled with: the annotation type and the marker's first word. */
const SUBSTITUTION_WORDS = [SUBSTITUTION_ANNOTATION_TYPE, 'substituted'] as const;

/**
 * How many single-character edits (insert, delete, replace, or swap two
 * neighbours) a word may sit from one of SUBSTITUTION_WORDS and still be read
 * as a misspelling of it. Two covers a dropped letter plus one more slip
 * (`subsituion`); three would reach real, unrelated words — `constitution`,
 * `institution` and `destitution` are each three edits from `substitution`.
 */
const MAX_TYPO_EDITS = 2;

/**
 * Optimal-string-alignment distance: the fewest inserts, deletes, replacements
 * and adjacent swaps turning `a` into `b`, or `limit + 1` when the lengths
 * alone put it past `limit`.
 */
function typoDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let twoRowsUp: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      let cost = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cost = Math.min(cost, twoRowsUp[j - 2] + 1);
      }
      current.push(cost);
    }
    twoRowsUp = previous;
    previous = current;
  }
  return previous[b.length];
}

/**
 * True when `word` reads as an attempt at `substitution` or `substituted`: in
 * any case, it either begins with `substitut` (`substitutions`, `substitute`)
 * or lies within MAX_TYPO_EDITS of one of them (`substituion`, `subsitution`,
 * `sbustituted`). Unrelated words stay out, so real prose and other annotation
 * types are never reported.
 */
export function isSubstitutionLikeWord(word: string): boolean {
  const lower = word.trim().toLowerCase();
  if (lower.startsWith('substitut')) return true;
  return SUBSTITUTION_WORDS.some((target) => typoDistance(lower, target, MAX_TYPO_EDITS) <= MAX_TYPO_EDITS);
}

/** A canonical marker, whole: `[substituted: ` + a component with no surrounding whitespace and no `]` + `]`. */
const CANONICAL_MARKER_RE = /^\[substituted: (\S(?:[^\]]*\S)?)\]$/;

/** A square-bracket group: from `[` to its `]`, or to the end of the title when it is never closed. */
const SQUARE_GROUP_RE = /\[[^\]]*(?:\]|$)/g;

/** A round or curly group — a marker written with the wrong brackets — closed by any bracket, or unclosed. */
const OTHER_GROUP_RE = /[({][^[\](){}]*(?:[\])}]|(?=[({])|$)/g;

/** The bracket that closes a group, of whichever kind, so `[substituted: X)` still reads its component as `X`. */
const GROUP_CLOSER_RE = /[\])}]$/;

/** A word directly followed by a colon: the marker's `substituted:` written with no brackets at all. */
const WORD_BEFORE_COLON_RE = /([A-Za-z]+)\s*:/g;

const WORD_RE = /[A-Za-z]+/g;
const LEADING_WORD_RE = /^\s*([A-Za-z]+)/;
/** What may sit between a near-miss marker's word and its component: the colon, or a stand-in for it. */
const MARKER_SEPARATOR_RE = /^[\s:;,.\-–—]+/;

interface MarkerAttempt {
  /** Where the attempt starts in the full title, to report attempts in reading order. */
  index: number;
  raw: string;
  /** Set when `raw` is a canonical marker: the component it names. */
  canonicalComponent: string | null;
  /**
   * For a near miss, the component it appears to name ('' when it names none),
   * or null when it cannot be read — the word is not the group's first.
   */
  intendedComponent: string | null;
}

/** Blank out `[start, end)` spans with spaces, keeping every other index where it was. */
function mask(text: string, spans: ReadonlyArray<readonly [number, number]>): string {
  let out = text;
  for (const [start, end] of spans) out = out.slice(0, start) + ' '.repeat(end - start) + out.slice(end);
  return out;
}

/**
 * Every place a title spells, or tries to spell, a substitution marker. A
 * substitution-like word (see `isSubstitutionLikeWord`) is an ATTEMPT when it
 * is the first word inside a bracket group of any kind, when it is anywhere
 * inside square brackets, or when a colon follows it. Deliberately loose, so a
 * near miss is REPORTED as malformed rather than silently read as "no marker
 * here" — a malformed marker declares nothing and would leave a substituted
 * spec eligible as `proven` evidence. The word in plain prose ("variable
 * substitution expands") is not an attempt.
 */
function findMarkerAttempts(title: string): MarkerAttempt[] {
  const attempts: MarkerAttempt[] = [];
  const consider = (index: number, raw: string, content: string, squareBrackets: boolean) => {
    const leading = LEADING_WORD_RE.exec(content);
    const leadsWithWord = leading !== null && isSubstitutionLikeWord(leading[1]);
    const anyWord = [...content.matchAll(WORD_RE)].some((m) => isSubstitutionLikeWord(m[0]));
    const wordBeforeColon = [...content.matchAll(WORD_BEFORE_COLON_RE)].some((m) => isSubstitutionLikeWord(m[1]));
    if (!leadsWithWord && !wordBeforeColon && !(squareBrackets && anyWord)) return;
    const canonical = CANONICAL_MARKER_RE.exec(raw);
    attempts.push({
      index,
      raw,
      canonicalComponent: canonical ? canonical[1] : null,
      intendedComponent:
        leadsWithWord && leading ? content.slice(leading[0].length).replace(MARKER_SEPARATOR_RE, '').trim() : null,
    });
  };

  const squareSpans: Array<[number, number]> = [];
  for (const match of title.matchAll(SQUARE_GROUP_RE)) {
    const start = match.index ?? 0;
    squareSpans.push([start, start + match[0].length]);
    consider(start, match[0], match[0].slice(1).replace(GROUP_CLOSER_RE, ''), true);
  }

  const withoutSquare = mask(title, squareSpans);
  const otherSpans: Array<[number, number]> = [];
  for (const match of withoutSquare.matchAll(OTHER_GROUP_RE)) {
    const start = match.index ?? 0;
    otherSpans.push([start, start + match[0].length]);
    consider(start, match[0], match[0].slice(1).replace(GROUP_CLOSER_RE, ''), false);
  }

  for (const match of mask(withoutSquare, otherSpans).matchAll(WORD_BEFORE_COLON_RE)) {
    if (!isSubstitutionLikeWord(match[1])) continue;
    attempts.push({ index: match.index ?? 0, raw: `"${match[0]}"`, canonicalComponent: null, intendedComponent: null });
  }

  return attempts.sort((a, b) => a.index - b.index);
}

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
  /** How many substitution-annotated tests each of `substitutedFiles` holds. */
  substitutedTestsByFile: Record<string, number>;
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
      if (isSubstitutionLikeWord(annotation.type)) {
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

  for (const attempt of findMarkerAttempts(test.fullTitle)) {
    const component = attempt.canonicalComponent;
    if (component === null) {
      const intended = attempt.intendedComponent;
      if (intended === '') {
        reasons.push(
          `malformed marker ${attempt.raw} — it names no component; write it as ${substitutionMarker('<component>')}`,
        );
      } else {
        reasons.push(
          `malformed marker ${attempt.raw} — write it exactly as ${substitutionMarker(intended ?? '<component>')}`,
        );
      }
      continue;
    }
    if (!declared.has(component)) {
      reasons.push(
        `title carries ${substitutionMarker(component)} but no substitution annotation declares "${component}" — ` +
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

  const substitutedTestsByFile: Record<string, number> = {};
  let substitutedTestCount = 0;
  for (const test of tests) {
    if (test.annotations.some((a) => a.type === SUBSTITUTION_ANNOTATION_TYPE)) {
      substitutedTestsByFile[test.file] = (substitutedTestsByFile[test.file] ?? 0) + 1;
      substitutedTestCount += 1;
    }
    for (const reason of checkTest(test)) {
      problems.push({ file: test.file, line: test.line, test: test.fullTitle, reason });
    }
  }

  return {
    specFiles: [...new Set(tests.map((t) => t.file))].sort(),
    testCount: tests.length,
    substitutedFiles: Object.keys(substitutedTestsByFile).sort(),
    substitutedTestsByFile,
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
