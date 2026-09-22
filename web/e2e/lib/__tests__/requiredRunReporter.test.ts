/**
 * Unit tests for `../requiredRunReporter.ts`.
 *
 * The auth-journey job (#8632) must not be able to go green having run nothing:
 * "a skipped job is not evidence". On a run that requires Clerk
 * (`E2E_CLERK_TEST_REQUIRED=true`, i.e. trusted CI), the reporter turns ANY
 * skip, a pass count below the floor, or an empty selection into a failed run.
 * Everywhere else (fork PRs, local runs without keys) it only reports.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import RequiredRunReporter, { countOutcomes, requiredRunProblems } from '../requiredRunReporter';

type Outcome = 'expected' | 'unexpected' | 'flaky' | 'skipped';

function fakeSuite(outcomes: Outcome[]) {
  const tests = outcomes.map((outcome, i) => ({
    title: `test ${i}`,
    titlePath: () => ['', 'chromium', 'auth-journey.spec.ts', `test ${i}`],
    outcome: () => outcome,
  }));
  return { allTests: () => tests } as never;
}

function runReporter(reporter: RequiredRunReporter, outcomes: Outcome[], status: 'passed' | 'failed' = 'passed') {
  reporter.onBegin({} as never, fakeSuite(outcomes));
  return reporter.onEnd({ status } as never);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('countOutcomes', () => {
  it('counts flaky as passed and unexpected as failed', () => {
    const suite = fakeSuite(['expected', 'flaky', 'unexpected', 'skipped', 'skipped']);
    expect(countOutcomes((suite as unknown as { allTests: () => never[] }).allTests())).toEqual({
      passed: 2,
      failed: 1,
      skipped: 2,
      total: 5,
    });
  });
});

describe('requiredRunProblems', () => {
  it('accepts a run where every selected test passed and the floor is met', () => {
    expect(requiredRunProblems({ passed: 2, failed: 0, skipped: 0, total: 2 }, { minPassed: 2 })).toEqual([]);
  });

  it('rejects an empty selection', () => {
    const problems = requiredRunProblems({ passed: 0, failed: 0, skipped: 0, total: 0 }, { minPassed: 2 });
    expect(problems.join('\n')).toMatch(/zero tests/);
  });

  it('rejects any skip, naming the count', () => {
    const problems = requiredRunProblems({ passed: 2, failed: 0, skipped: 1, total: 3 }, { minPassed: 2 });
    expect(problems.join('\n')).toMatch(/1 test\(s\) skipped/);
  });

  it('rejects a pass count below the floor', () => {
    const problems = requiredRunProblems({ passed: 1, failed: 0, skipped: 0, total: 1 }, { minPassed: 2 });
    expect(problems.join('\n')).toMatch(/1 passed, expected at least 2/);
  });
});

describe('RequiredRunReporter', () => {
  it('fails a required run that skipped a test, and says why', () => {
    vi.stubEnv('E2E_CLERK_TEST_REQUIRED', 'true');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = runReporter(new RequiredRunReporter({ minPassed: 2 }), ['expected', 'expected', 'skipped']);

    expect(result).toEqual({ status: 'failed' });
    expect(error.mock.calls.flat().join('\n')).toMatch(/skipped/);
  });

  it('fails a required run whose pass count is below the floor', () => {
    vi.stubEnv('E2E_CLERK_TEST_REQUIRED', 'true');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(runReporter(new RequiredRunReporter({ minPassed: 2 }), ['expected'])).toEqual({ status: 'failed' });
  });

  it('leaves a healthy required run alone', () => {
    vi.stubEnv('E2E_CLERK_TEST_REQUIRED', 'true');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(runReporter(new RequiredRunReporter({ minPassed: 2 }), ['expected', 'flaky'])).toBeUndefined();
    expect(log.mock.calls.flat().join('\n')).toMatch(/2 passed, 0 skipped, 0 failed of 2/);
  });

  it('only reports on a run that does not require Clerk (fork PRs skip by design)', () => {
    for (const value of [undefined, 'false', 'TRUE', '1']) {
      vi.stubEnv('E2E_CLERK_TEST_REQUIRED', value);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      expect(runReporter(new RequiredRunReporter({ minPassed: 2 }), ['skipped', 'skipped'])).toBeUndefined();
    }
  });

  it('does not mask a run that already failed', () => {
    vi.stubEnv('E2E_CLERK_TEST_REQUIRED', 'true');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(runReporter(new RequiredRunReporter({ minPassed: 2 }), ['unexpected', 'expected'], 'failed')).toEqual({
      status: 'failed',
    });
  });
});
