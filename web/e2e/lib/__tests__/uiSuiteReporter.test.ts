/**
 * Unit tests for the pure selection logic and the reporter in
 * `../uiSuiteReporter.ts`. No browser: `preprocess()` is driven with a fake
 * Suite/TestRun so the selection count assertion and the exclude() calls are
 * verified directly.
 *
 * Covers issue #9636: the @ui preprocess selection must pick a non-zero,
 * plausible set, mark everything else out of the run, and FAIL when the count
 * is zero or implausible (the #9586 mis-selection the grep pair hid).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import UiSuiteReporter, {
  DEFAULT_MIN_SELECTED,
  UI_SUITE_ENV_FLAG,
  assertPlausibleSelection,
  isUiSuiteTest,
  normalizeTag,
  partitionUiSuite,
  type Tagged,
} from '../uiSuiteReporter';

/** Minimal stand-in for a Playwright TestCase (only `tags` is read). */
function t(...tags: string[]): Tagged {
  return { tags };
}

/** Build a fake Playwright Suite + spy TestRun over the given tagged tests. */
function fakeRun(tests: Tagged[]) {
  const excluded: Tagged[] = [];
  const suite = { allTests: () => tests } as never;
  const testRun = {
    exclude: (test: Tagged) => {
      excluded.push(test);
    },
    skip: vi.fn(),
    fail: vi.fn(),
    fixme: vi.fn(),
    skipSharding: vi.fn(),
  } as never;
  return { suite, testRun, excluded };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('normalizeTag', () => {
  it('strips a single leading @', () => {
    expect(normalizeTag('@ui')).toBe('ui');
    expect(normalizeTag('ui')).toBe('ui');
    expect(normalizeTag('@engine-ui')).toBe('engine-ui');
  });
});

describe('isUiSuiteTest', () => {
  it('selects @ui (runtime and JSON tag forms)', () => {
    expect(isUiSuiteTest(['@ui'])).toBe(true);
    expect(isUiSuiteTest(['ui'])).toBe(true);
  });

  it('rejects tests without @ui', () => {
    expect(isUiSuiteTest(['api'])).toBe(false);
    expect(isUiSuiteTest(['engine'])).toBe(false);
    expect(isUiSuiteTest([])).toBe(false);
  });

  it('excludes @ui tests that are also @engine-ui or @journey', () => {
    expect(isUiSuiteTest(['ui', 'engine-ui'])).toBe(false);
    expect(isUiSuiteTest(['ui', 'journey'])).toBe(false);
    expect(isUiSuiteTest(['@ui', '@journey'])).toBe(false);
  });
});

describe('partitionUiSuite', () => {
  it('splits into selected/excluded with counts summing to total', () => {
    const tests = [
      t('ui'), // selected
      t('ui', 'smoke'), // selected
      t('ui', 'engine-ui'), // excluded
      t('ui', 'journey'), // excluded
      t('api'), // excluded
      t('engine'), // excluded
    ];
    const { selected, excluded } = partitionUiSuite(tests);
    expect(selected).toHaveLength(2);
    expect(excluded).toHaveLength(4);
    expect(selected.length + excluded.length).toBe(tests.length);
  });

  it('reproduces the grep pair on a representative corpus (387/680 shape)', () => {
    // Same predicate the clean-tree measurement confirmed matches
    // `--grep '@ui' --grep-invert '@engine-ui|@journey'` (387 of 680).
    const tests: Tagged[] = [
      ...Array.from({ length: 387 }, () => t('ui')),
      ...Array.from({ length: 37 }, () => t('ui', 'engine-ui')),
      ...Array.from({ length: 7 }, () => t('ui', 'journey')),
      ...Array.from({ length: 249 }, () => t('engine')),
    ];
    const { selected, excluded } = partitionUiSuite(tests);
    expect(selected).toHaveLength(387);
    expect(excluded).toHaveLength(293);
  });
});

describe('assertPlausibleSelection', () => {
  it('passes for a healthy selection', () => {
    expect(() =>
      assertPlausibleSelection({ selected: 387, total: 680 }),
    ).not.toThrow();
  });

  it('throws when the selection is empty', () => {
    expect(() =>
      assertPlausibleSelection({ selected: 0, total: 680 }),
    ).toThrow(/EMPTY/);
  });

  it('throws when the selection is below the floor', () => {
    expect(() =>
      assertPlausibleSelection({ selected: 91, total: 422 }),
    ).toThrow(/implausibly low/);
  });

  it('throws when nothing was excluded (selected === total)', () => {
    expect(() =>
      assertPlausibleSelection({ selected: 680, total: 680 }),
    ).toThrow(/excluded nothing/);
  });

  it('honours a custom minSelected floor', () => {
    expect(() =>
      assertPlausibleSelection({ selected: 5, total: 100 }, { minSelected: 3 }),
    ).not.toThrow();
    expect(() =>
      assertPlausibleSelection({ selected: 5, total: 100 }, { minSelected: 10 }),
    ).toThrow(/implausibly low/);
  });

  it('DEFAULT_MIN_SELECTED is the documented floor', () => {
    expect(DEFAULT_MIN_SELECTED).toBe(250);
  });
});

describe('UiSuiteReporter.preprocess', () => {
  const healthy: Tagged[] = [
    ...Array.from({ length: 300 }, () => t('ui')),
    ...Array.from({ length: 37 }, () => t('ui', 'engine-ui')),
    ...Array.from({ length: 100 }, () => t('api')),
  ];

  it('is a no-op when disabled — no tests excluded, no assertion', async () => {
    const reporter = new UiSuiteReporter({ enabled: false });
    const { suite, testRun, excluded } = fakeRun(healthy);
    await reporter.preprocess({ suite, testRun });
    expect(excluded).toHaveLength(0);
  });

  it('is a no-op when PW_UI_SUITE is unset (the shared @api job)', async () => {
    vi.stubEnv(UI_SUITE_ENV_FLAG, '');
    const reporter = new UiSuiteReporter();
    const { suite, testRun, excluded } = fakeRun(healthy);
    await reporter.preprocess({ suite, testRun });
    expect(excluded).toHaveLength(0);
  });

  it('activates when PW_UI_SUITE=1 and excludes only the non-@ui tests', async () => {
    vi.stubEnv(UI_SUITE_ENV_FLAG, '1');
    const reporter = new UiSuiteReporter();
    const { suite, testRun, excluded } = fakeRun(healthy);
    await reporter.preprocess({ suite, testRun });
    // 37 @engine-ui + 100 @api = 137 excluded; 300 @ui selected.
    expect(excluded).toHaveLength(137);
    expect(excluded.every((test) => !isUiSuiteTest(test.tags))).toBe(true);
  });

  it('when enabled: true, excludes without needing the env var', async () => {
    const reporter = new UiSuiteReporter({ enabled: true });
    const { suite, testRun, excluded } = fakeRun(healthy);
    await reporter.preprocess({ suite, testRun });
    expect(excluded).toHaveLength(137);
  });

  it('rejects and excludes nothing when the @ui selection is empty', async () => {
    const reporter = new UiSuiteReporter({ enabled: true });
    const { suite, testRun, excluded } = fakeRun([t('api'), t('engine')]);
    await expect(reporter.preprocess({ suite, testRun })).rejects.toThrow(
      /EMPTY/,
    );
    expect(excluded).toHaveLength(0);
  });

  it('rejects when the selection is implausibly low', async () => {
    const reporter = new UiSuiteReporter({ enabled: true });
    const suiteTests: Tagged[] = [
      ...Array.from({ length: 5 }, () => t('ui')),
      ...Array.from({ length: 100 }, () => t('api')),
    ];
    const { suite, testRun } = fakeRun(suiteTests);
    await expect(reporter.preprocess({ suite, testRun })).rejects.toThrow(
      /implausibly low/,
    );
  });

  it('does not print to Playwright stdio channel implicitly', () => {
    expect(new UiSuiteReporter().printsToStdio()).toBe(true);
  });
});
