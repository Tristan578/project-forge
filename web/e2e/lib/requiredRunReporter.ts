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
 * Optional runs also emit aggregate counts and the configured safe summary;
 * summary-write failures still fail the run.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestError } from '@playwright/test/reporter';
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

type OutcomeCarrier = Pick<TestCase, 'outcome' | 'expectedStatus' | 'results'>;

/**
 * Tally actual final results: a successful retry passes; an expected failure does not.
 * @param tests Every test in the run.
 * @returns Counts by outcome.
 */
export function countOutcomes(tests: readonly OutcomeCarrier[]): RunCounts {
  const counts: RunCounts = { passed: 0, failed: 0, skipped: 0, total: tests.length };
  for (const test of tests) {
    const outcome = test.outcome();
    const finalStatus = test.results.at(-1)?.status;
    if (test.expectedStatus === 'passed' && finalStatus === 'passed' &&
        (outcome === 'expected' || outcome === 'flaky')) counts.passed++;
    else if (outcome === 'skipped' || finalStatus === 'skipped') counts.skipped++;
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
  if (counts.failed > 0) problems.push(`${counts.failed} test(s) did not actually pass`);
  if (counts.passed < options.minPassed) {
    problems.push(`${counts.passed} passed, expected at least ${options.minPassed}`);
  }
  return problems;
}

export interface RequiredRunReporterConfig extends Partial<RequiredRunOptions> {
  /** Force on/off; otherwise enabled iff `E2E_CLERK_TEST_REQUIRED === 'true'`. */
  enabled?: boolean;
  /** Optional credential-safe artifact; contains only aggregate counts and status. */
  summaryPath?: string;
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
  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    const counts = countOutcomes(this.suite?.allTests() ?? []);
    const required = this.isRequired();
    console.log(
      `[requiredRunReporter] ${counts.passed} passed, ${counts.skipped} skipped, ${counts.failed} failed ` +
        `of ${counts.total} (${CLERK_REQUIRED_ENV}=${required ? 'true' : 'false'}).`,
    );
    const problems = required
      ? requiredRunProblems(counts, { minPassed: this.options.minPassed ?? DEFAULT_MIN_PASSED })
      : [];
    if (this.options.summaryPath) {
      const status = problems.length > 0 ? 'failed' : result.status;
      // Never serialize Playwright objects: errors, titles, stdout and attachments
      // can contain reusable credentials even when browser tracing is disabled.
      const summary = { schemaVersion: 1, status, required, ...counts };
      try {
        await mkdir(dirname(this.options.summaryPath), { recursive: true });
        await writeFile(this.options.summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
      } catch {
        // Playwright swallows reporter exceptions. Return failure explicitly so
        // an I/O error cannot bypass required-run enforcement or artifact proof.
        console.error('[requiredRunReporter] FAIL: could not write the credential-safe summary.');
        return { status: 'failed' };
      }
    }
    if (problems.length === 0) return undefined;
    for (const problem of problems) {
      console.error(`[requiredRunReporter] FAIL: ${problem}`);
    }
    // Never downgrade: a run that already failed stays failed.
    return { status: 'failed' };
  }

  onError(_error: TestError): void {
    console.error('[requiredRunReporter] Playwright reported a run error; check the test-instance setup.');
  }

  onStdOut(_chunk: string | Buffer): void {
    // Suppress worker output: only the aggregate summary is publishable.
  }

  onStdErr(_chunk: string | Buffer): void {
    // Do not forward raw authentication errors or network payloads.
  }

  printsToStdio(): boolean {
    // Otherwise Playwright adds its default reporter, which prints raw failures.
    return true;
  }
}
