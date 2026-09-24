/**
 * Unit tests for `../requiredRunReporter.ts`.
 *
 * The auth-journey job (#8632) must not be able to go green having run nothing:
 * "a skipped job is not evidence". On a run that requires Clerk
 * (`E2E_CLERK_TEST_REQUIRED=true`, i.e. trusted CI), the reporter turns ANY
 * skip, a pass count below the floor, or an empty selection into a failed run.
 * Everywhere else (fork PRs, local runs without keys) it only reports.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RequiredRunReporter, { countOutcomes, requiredRunProblems } from '../requiredRunReporter';

type Outcome = 'expected' | 'unexpected' | 'flaky' | 'skipped';

function fakeSuite(outcomes: Outcome[]) {
  const tests = outcomes.map((outcome, i) => ({
    title: `test ${i}`,
    titlePath: () => ['', 'chromium', 'auth-journey.spec.ts', `test ${i}`],
    outcome: () => outcome,
    expectedStatus: 'passed',
    results: [{ status: outcome === 'expected' || outcome === 'flaky' ? 'passed' : outcome === 'skipped' ? 'skipped' : 'failed' }],
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
  it('counts flaky as passed and unexpected as failed', async () => {
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
  it('accepts a run where every selected test passed and the floor is met', async () => {
    expect(requiredRunProblems({ passed: 2, failed: 0, skipped: 0, total: 2 }, { minPassed: 2 })).toEqual([]);
  });

  it('rejects an empty selection', async () => {
    const problems = requiredRunProblems({ passed: 0, failed: 0, skipped: 0, total: 0 }, { minPassed: 2 });
    expect(problems.join('\n')).toMatch(/zero tests/);
  });

  it('rejects any skip, naming the count', async () => {
    const problems = requiredRunProblems({ passed: 2, failed: 0, skipped: 1, total: 3 }, { minPassed: 2 });
    expect(problems.join('\n')).toMatch(/1 test\(s\) skipped/);
  });

  it('rejects a pass count below the floor', async () => {
    const problems = requiredRunProblems({ passed: 1, failed: 0, skipped: 0, total: 1 }, { minPassed: 2 });
    expect(problems.join('\n')).toMatch(/1 passed, expected at least 2/);
  });
});

describe('RequiredRunReporter', () => {
  it('fails a required run that skipped a test, and says why', async () => {
    vi.stubEnv('E2E_CLERK_TEST_REQUIRED', 'true');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await runReporter(new RequiredRunReporter({ minPassed: 2 }), ['expected', 'expected', 'skipped']);

    expect(result).toEqual({ status: 'failed' });
    expect(error.mock.calls.flat().join('\n')).toMatch(/skipped/);
  });

  it('fails a required run whose pass count is below the floor', async () => {
    vi.stubEnv('E2E_CLERK_TEST_REQUIRED', 'true');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await runReporter(new RequiredRunReporter({ minPassed: 2 }), ['expected'])).toEqual({ status: 'failed' });
  });

  it('leaves a healthy required run alone', async () => {
    vi.stubEnv('E2E_CLERK_TEST_REQUIRED', 'true');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await runReporter(new RequiredRunReporter({ minPassed: 2 }), ['expected', 'flaky'])).toBeUndefined();
    expect(log.mock.calls.flat().join('\n')).toMatch(/2 passed, 0 skipped, 0 failed of 2/);
  });

  it('only reports on a run that does not require Clerk (fork PRs skip by design)', async () => {
    for (const value of [undefined, 'false', 'TRUE', '1']) {
      vi.stubEnv('E2E_CLERK_TEST_REQUIRED', value);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      expect(await runReporter(new RequiredRunReporter({ minPassed: 2 }), ['skipped', 'skipped'])).toBeUndefined();
    }
  });

  it('does not mask a run that already failed', async () => {
    vi.stubEnv('E2E_CLERK_TEST_REQUIRED', 'true');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await runReporter(new RequiredRunReporter({ minPassed: 2 }), ['unexpected', 'expected'], 'failed')).toEqual({
      status: 'failed',
    });
  });
});

describe('credential-safe auth reporting', () => {
  it('suppresses raw runner errors and output', () => {
    const secret = 'AUTH_SENTINEL_raw_runner_error';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reporter = new RequiredRunReporter();
    reporter.onStdOut(secret);
    reporter.onStdErr(Buffer.from(secret));
    reporter.onError({ message: secret, stack: secret });
    expect(log).not.toHaveBeenCalled();
    expect(error.mock.calls).toEqual([
      ['[requiredRunReporter] Playwright reported a run error; check the test-instance setup.'],
    ]);
  });

  it('writes only allowlisted aggregate data, never test errors or attachments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'auth-summary-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const secret = 'sentinel-password-and-session-token';
      const reporter = new RequiredRunReporter({ enabled: true, summaryPath: join(dir, 'summary.json') });
      reporter.onBegin({} as never, {
        allTests: () => [{
          title: secret,
          expectedStatus: 'passed',
          outcome: () => 'unexpected',
          results: [{ status: 'failed', errors: [{ message: secret }], stdout: [secret],
            attachments: [{ name: secret, body: Buffer.from(secret) }] }],
        }],
      } as never);
      expect(await reporter.onEnd({ status: 'failed', secret } as never)).toEqual({ status: 'failed' });
      const text = await readFile(join(dir, 'summary.json'), 'utf8');
      expect(JSON.parse(text)).toEqual({
        schemaVersion: 1, status: 'failed', required: true,
        passed: 0, failed: 1, skipped: 0, total: 1,
      });
      expect(text).not.toContain(secret);
      expect(reporter.printsToStdio()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each([true, false])('fails explicitly if its summary cannot be written (required=%s)', async (enabled) => {
    const dir = await mkdtemp(join(tmpdir(), 'auth-summary-'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      // A directory cannot be overwritten as a summary file.
      const reporter = new RequiredRunReporter({ enabled, summaryPath: dir });
      expect(await runReporter(reporter, enabled ? ['skipped', 'skipped'] : ['expected', 'expected']))
        .toEqual({ status: 'failed' });
      expect(error.mock.calls.flat().join('\n')).toContain('could not write the credential-safe summary');
      expect(error.mock.calls.flat().join('\n')).not.toContain(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects expected failures even when Playwright calls their outcome expected', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reporter = new RequiredRunReporter({ enabled: true, minPassed: 2 });
    reporter.onBegin({} as never, {
      allTests: () => [1, 2].map(() => ({
        expectedStatus: 'failed', outcome: () => 'expected', results: [{ status: 'failed' }],
      })),
    } as never);
    expect(await reporter.onEnd({ status: 'passed' } as never)).toEqual({ status: 'failed' });
  });
});
