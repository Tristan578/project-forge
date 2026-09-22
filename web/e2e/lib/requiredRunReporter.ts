/**
 * requiredRunReporter — fails a Playwright run that was REQUIRED to exercise
 * Clerk but did not (#8632).
 *
 * The auth-journey specs skip themselves when Clerk keys are absent, which is
 * correct on fork and Dependabot PRs (no repository secrets) and wrong
 * everywhere else. `clerkGlobalSetup.ts` already throws when a required run has
 * no keys; this reporter closes the rest of that gap from the other end: on a
 * required run (`E2E_CLERK_TEST_REQUIRED=true`), ANY skipped test, a pass count
 * below `minPassed`, or an empty selection turns the run red. A green job must
 * mean the journey ran — lessons-learned #9: a check that scans zero items, or
 * skips its key assertion, must fail rather than report success.
 *
 * On a run that is not required it only prints the counts.
 */
import type { FullConfig, FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';
import { CLERK_REQUIRED_ENV } from './clerkTesting';

export interface RunCounts {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface RequiredRunOptions {
  /** Fewest passed tests a required run may report. */
  minPassed: number;
}

type OutcomeCarrier = Pick<TestCase, 'outcome'>;

/**
 * Tally final outcomes (after retries): `flaky` counts as passed.
 * @param tests Every test in the run.
 * @returns Counts by outcome.
 */
export function countOutcomes(tests: readonly OutcomeCarrier[]): RunCounts {
  const counts: RunCounts = { passed: 0, failed: 0, skipped: 0, total: tests.length };
  for (const test of tests) {
    const outcome = test.outcome();
    if (outcome === 'expected' || outcome === 'flaky') counts.passed++;
    else if (outcome === 'skipped') counts.skipped++;
    else counts.failed++;
  }
  return counts;
}

/**
 * Reasons a REQUIRED run does not count as evidence.
 * @param counts Final outcome tally.
 * @param options Pass-count floor.
 * @returns Human-readable problems; empty when the run is acceptable.
 */
export function requiredRunProblems(counts: RunCounts, options: RequiredRunOptions): string[] {
  const problems: string[] = [];
  if (counts.total === 0) {
    problems.push('the run selected zero tests, so it proves nothing about the auth journey');
  }
  if (counts.skipped > 0) {
    problems.push(
      `${counts.skipped} test(s) skipped on a run that requires Clerk — a skip here means the journey did not run`,
    );
  }
  if (counts.passed < options.minPassed) {
    problems.push(`${counts.passed} passed, expected at least ${options.minPassed}`);
  }
  return problems;
}

export interface RequiredRunReporterConfig extends Partial<RequiredRunOptions> {
  /** Force on/off; otherwise enabled iff `E2E_CLERK_TEST_REQUIRED === 'true'`. */
  enabled?: boolean;
}

/** Default floor: the Sign In navigation test and the sign-in journey. */
export const DEFAULT_MIN_PASSED = 2;

export default class RequiredRunReporter implements Reporter {
  private readonly options: RequiredRunReporterConfig;
  private suite: Suite | undefined;

  constructor(options: RequiredRunReporterConfig = {}) {
    this.options = options;
  }

  private isRequired(): boolean {
    if (typeof this.options.enabled === 'boolean') return this.options.enabled;
    return process.env[CLERK_REQUIRED_ENV] === 'true';
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.suite = suite;
  }

  // Playwright only honours a status override returned through a Promise.
  async onEnd(_result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    const counts = countOutcomes(this.suite?.allTests() ?? []);
    const required = this.isRequired();
    console.log(
      `[requiredRunReporter] ${counts.passed} passed, ${counts.skipped} skipped, ${counts.failed} failed ` +
        `of ${counts.total} (${CLERK_REQUIRED_ENV}=${required ? 'true' : 'false'}).`,
    );
    if (!required) return undefined;
    const problems = requiredRunProblems(counts, { minPassed: this.options.minPassed ?? DEFAULT_MIN_PASSED });
    if (problems.length === 0) return undefined;
    for (const problem of problems) {
      console.error(`[requiredRunReporter] FAIL: ${problem}`);
    }
    // Never downgrade: a run that already failed stays failed.
    return { status: 'failed' };
  }

  printsToStdio(): boolean {
    return false;
  }
}
