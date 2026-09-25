/**
 * Post-run check over the `journey-evidence` directory (#10157).
 *
 * Reads the index `journeyEvidenceReporter.ts` wrote and fails unless there is
 * exactly one valid evidence record per journey-tagged test the run selected.
 * Each rule closes a way the artifact could look complete while proving
 * nothing (lessons-learned #1, #9, #11):
 *
 *   - no index at all            the reporter was unregistered or never ran;
 *   - fewer than `minJourneys`   a check over zero journeys passes vacuously;
 *   - a test with no record      e.g. the fixture's attach call was removed;
 *   - a stray or duplicate record  "one per test" must hold in both directions;
 *   - a record failing the schema  including an outcome that does not follow
 *                                  from Playwright's attempt statuses;
 *   - a missing trace or video   for any attempt that actually ran;
 *   - SHAs that are not this run's (CI passes the expected values): the
 *     record's GITHUB_SHA and PR head, and the commit `/api/health` reported,
 *     which is the first 8 characters of the SHA the server was started with.
 *
 * A flaky or not-run journey does NOT fail this check — the record states it
 * and it is excluded from the proven count. A red journey fails the Playwright
 * run itself; this check is about whether the evidence exists and is honest.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  countJourneyOutcomes,
  zJourneyEvidence,
  zJourneyEvidenceIndex,
  type JourneyEvidence,
  type JourneyOutcome,
} from './journeyEvidence';

/** `/api/health` exposes this many characters of the commit (route.ts). */
export const HEALTH_COMMIT_LENGTH = 8;

export interface JourneyEvidenceCheckOptions {
  dir: string;
  /** Fewer journey-tagged tests than this is a failure. Defaults to 1; never below 1. */
  minJourneys?: number;
  /** When set, every record must carry this GITHUB_SHA and `/api/health` its prefix. */
  expectGithubSha?: string | null;
  /**
   * When provided, every record's PR head must equal it; `null` (or '') means
   * the run had no PR head (push / dispatch). `undefined` skips the rule.
   */
  expectPrHeadSha?: string | null;
}

export interface JourneyEvidenceCheckResult {
  problems: string[];
  /** Journey-tagged tests the run selected (index entries), with or without a record. */
  selected: number;
  journeys: Array<{ title: string; journeyId: string; outcome: JourneyOutcome; evidence: string }>;
  counts: ReturnType<typeof countJourneyOutcomes>;
}

function readJson(file: string): { value: unknown } | { error: string } {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return { error: `cannot read ${file}: ${(error as NodeJS.ErrnoException).code ?? String(error)}` };
  }
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: `${file} is not JSON` };
  }
}

/** Resolve a relative path inside `dir`, or null when it escapes it. */
function inside(dir: string, rel: string): string | null {
  const resolved = path.resolve(dir, rel);
  const fromDir = path.relative(dir, resolved);
  return fromDir === '' || fromDir.startsWith('..') || path.isAbsolute(fromDir) ? null : resolved;
}

function nonEmptyFile(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

/** Every `evidence.json` under `dir`, relative and `/`-separated. */
function evidenceFilesOnDisk(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'evidence.json') found.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return found.sort();
}

export function checkJourneyEvidence(options: JourneyEvidenceCheckOptions): JourneyEvidenceCheckResult {
  const dir = path.resolve(options.dir);
  const minJourneys = Math.max(1, options.minJourneys ?? 1);
  const problems: string[] = [];
  const journeys: JourneyEvidenceCheckResult['journeys'] = [];
  const evidences: JourneyEvidence[] = [];
  let selected = 0;
  const result = () => ({ problems, selected, journeys, counts: countJourneyOutcomes(evidences) });

  const indexFile = path.join(dir, 'index.json');
  if (!fs.existsSync(indexFile)) {
    problems.push(
      `no index.json in ${dir}: the journey evidence reporter did not run ` +
        '(is e2e/lib/journeyEvidenceReporter.ts registered in the Playwright config?)',
    );
    return result();
  }
  const rawIndex = readJson(indexFile);
  if ('error' in rawIndex) {
    problems.push(rawIndex.error);
    return result();
  }
  const index = zJourneyEvidenceIndex.safeParse(rawIndex.value);
  if (!index.success) {
    problems.push(`index.json is invalid: ${index.error.issues.map((i) => i.message).join('; ')}`);
    return result();
  }

  problems.push(...index.data.problems);
  const tests = index.data.tests;
  selected = tests.length;
  if (tests.length < minJourneys) {
    problems.push(
      `the run selected ${tests.length} journey-tagged tests; expected at least ${minJourneys} — ` +
        'a check over zero journeys passes vacuously',
    );
  }

  const seen = new Map<string, number>();
  for (const t of tests) seen.set(t.test.id, (seen.get(t.test.id) ?? 0) + 1);
  for (const [id, n] of seen) {
    if (n > 1) problems.push(`test ${id} is listed ${n} times in index.json; expected one record per test`);
  }

  const expectedFiles = new Set<string>();
  for (const entry of tests) {
    const label = `journey test "${entry.test.title}" (${entry.test.file})`;
    if (entry.evidence === null) {
      problems.push(`${label} has no record: ${entry.problem ?? 'no reason given'}`);
      continue;
    }
    expectedFiles.add(entry.evidence);
    const file = inside(dir, entry.evidence);
    if (file === null) {
      problems.push(`${label}: evidence path ${entry.evidence} escapes ${dir}`);
      continue;
    }
    const raw = readJson(file);
    if ('error' in raw) {
      problems.push(`${label}: ${raw.error}`);
      continue;
    }
    const parsed = zJourneyEvidence.safeParse(raw.value);
    if (!parsed.success) {
      problems.push(
        `${label}: invalid evidence in ${entry.evidence}: ` +
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
      continue;
    }
    const evidence = parsed.data;
    if (evidence.test.id !== entry.test.id) {
      problems.push(`${label}: ${entry.evidence} is the record of test ${evidence.test.id}`);
      continue;
    }
    evidences.push(evidence);
    journeys.push({
      title: entry.test.title,
      journeyId: evidence.journeyId,
      outcome: evidence.outcome,
      evidence: entry.evidence,
    });

    for (const a of evidence.attempts) {
      if (a.status === 'skipped') continue; // a not-run attempt has nothing to show
      const artifacts: Array<[string, string | null]> = [
        ['trace', a.trace],
        ...(a.video.length > 0 ? a.video.map((v): [string, string] => ['video', v]) : [['video', null] as [string, null]]),
      ];
      for (const [kind, rel] of artifacts) {
        if (rel === null) {
          problems.push(`${label}: attempt ${a.attempt} has no ${kind}`);
          continue;
        }
        const artifact = inside(dir, rel);
        if (artifact === null) problems.push(`${label}: attempt ${a.attempt} ${kind} path ${rel} escapes ${dir}`);
        else if (!nonEmptyFile(artifact)) problems.push(`${label}: attempt ${a.attempt} ${kind} ${rel} is missing or empty`);
      }
    }

    const sha = evidence.record.sha;
    if (options.expectGithubSha) {
      const expected = options.expectGithubSha.toLowerCase();
      if (sha.github !== expected) {
        problems.push(`${label}: record carries GITHUB_SHA ${sha.github ?? 'none'}, expected ${expected}`);
      }
      const expectedHealth = expected.slice(0, HEALTH_COMMIT_LENGTH);
      if (sha.health !== expectedHealth) {
        problems.push(
          `${label}: /api/health reported commit "${sha.health ?? 'none'}", expected "${expectedHealth}" ` +
            `(the server under test is not this run's commit${sha.healthError ? `; ${sha.healthError}` : ''})`,
        );
      }
    }
    if (options.expectPrHeadSha !== undefined) {
      const expected = options.expectPrHeadSha ? options.expectPrHeadSha.toLowerCase() : null;
      if (sha.prHead !== expected) {
        problems.push(`${label}: record carries PR head ${sha.prHead ?? 'none'}, expected ${expected ?? 'none'}`);
      }
    }
  }

  for (const file of evidenceFilesOnDisk(dir)) {
    if (!expectedFiles.has(file)) {
      problems.push(`${file} is not listed in index.json: a record that no journey-tagged test accounts for`);
    }
  }

  return result();
}
