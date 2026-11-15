/**
 * uiSuiteReporter — programmatic @ui-suite selection for CI, replacing the
 * `--grep '@ui' --grep-invert '@engine-ui|@journey'` CLI pair.
 *
 * WHY THIS EXISTS
 * ---------------
 * The grep pair is the exact shape called out in
 * `.claude/rules/lessons-learned.md` #1 (#9586): selecting with one expression
 * and grep-inverting with another that also matches the selectors silently
 * excluded 91 of 422 tests, and a grep-invert can never report how many tests
 * it removed — a mis-selection reads as a green, smaller run.
 *
 * Playwright 1.62's `reporter.preprocess()` receives the resolved suite before
 * `onBegin` and can remove tests from the run programmatically. Crucially, it
 * can COUNT its own selection and FAIL the run when that count is zero or
 * implausible — the assertion a grep-invert structurally cannot make.
 *
 * SELECTION SEMANTICS (identical set to the grep pair)
 * ----------------------------------------------------
 * A test is selected iff it is tagged `@ui` AND is not tagged `@engine-ui` or
 * `@journey`. Playwright's runtime `TestCase.tags` carry the leading `@`, while
 * its JSON reporter strips it; `normalizeTag` tolerates both so the same logic
 * holds regardless of which representation a caller passes.
 *
 * exclude() vs skip(): out-of-selection tests are `exclude()`d, not `skip()`d.
 * `exclude()` is the exact behavioural equivalent of `--grep-invert` — the test
 * is not run and does not appear in the report — so the report's stats stay
 * identical to the grep pair's instead of ballooning with hundreds of skipped
 * @api/@engine specs that were never in the @ui run to begin with.
 *
 * ENV GATING
 * ----------
 * `playwright.ci.config.ts` is shared by the @ui job (which drops the greps and
 * sets `PW_UI_SUITE=1`) and the @api job (which keeps `--grep '@api'` and does
 * not set it). The reporter is therefore a no-op unless enabled, so it never
 * touches the @api selection.
 */
import type {
  Reporter,
  Suite,
  TestCase,
  TestRun,
} from '@playwright/test/reporter';

/** Env var the @ui CI job sets to `'1'` to activate programmatic selection. */
export const UI_SUITE_ENV_FLAG = 'PW_UI_SUITE';

/** Tag that selects a test into the @ui suite. */
export const SELECT_TAG = 'ui';

/** Tags that remove an otherwise-@ui test from the suite. */
export const EXCLUDE_TAGS: readonly string[] = ['engine-ui', 'journey'];

/**
 * Floor for the plausible selected-test count. Measured clean-tree count on
 * 2026-09-15 was 387 selected of 680 (see PR #9636 body). A floor of 250 leaves
 * headroom for normal test churn while still catching a catastrophic
 * mis-selection like #9586's 91-of-422.
 */
export const DEFAULT_MIN_SELECTED = 250;

export interface UiSuiteSelectionOptions {
  /** Minimum plausible selected-test count. Defaults to {@link DEFAULT_MIN_SELECTED}. */
  minSelected?: number;
}

export interface UiSuiteReporterConfig extends UiSuiteSelectionOptions {
  /**
   * Force the reporter on or off. When omitted, the reporter is enabled iff
   * `process.env[PW_UI_SUITE] === '1'`.
   */
  enabled?: boolean;
}

export interface Tagged {
  readonly tags: readonly string[];
}

export interface SelectionResult<T> {
  selected: T[];
  excluded: T[];
}

/** Strip a single leading `@` so runtime (`@ui`) and JSON (`ui`) tags compare equal. */
export function normalizeTag(tag: string): string {
  return tag.startsWith('@') ? tag.slice(1) : tag;
}

/** True iff the tags select the test into the @ui suite (@ui and not @engine-ui/@journey). */
export function isUiSuiteTest(tags: readonly string[]): boolean {
  const norm = new Set(tags.map(normalizeTag));
  return norm.has(SELECT_TAG) && !EXCLUDE_TAGS.some((tag) => norm.has(tag));
}

/** Partition tests into the @ui selection and everything else. */
export function partitionUiSuite<T extends Tagged>(
  tests: readonly T[],
): SelectionResult<T> {
  const selected: T[] = [];
  const excluded: T[] = [];
  for (const test of tests) {
    if (isUiSuiteTest(test.tags)) {
      selected.push(test);
    } else {
      excluded.push(test);
    }
  }
  return { selected, excluded };
}

/**
 * Throw when the selection is empty, implausibly small, or excluded nothing —
 * the failure a grep-invert cannot surface. `total` is the full corpus size.
 */
export function assertPlausibleSelection(
  counts: { selected: number; total: number },
  options: UiSuiteSelectionOptions = {},
): void {
  const min = options.minSelected ?? DEFAULT_MIN_SELECTED;
  const { selected, total } = counts;
  if (selected === 0) {
    throw new Error(
      `[uiSuiteReporter] @ui suite selection is EMPTY: 0 of ${total} tests matched ` +
        `(@${SELECT_TAG} and not @${EXCLUDE_TAGS.join('/@')}). This is the #9586 failure mode — ` +
        `refusing to run a vacuous @ui suite.`,
    );
  }
  if (selected < min) {
    throw new Error(
      `[uiSuiteReporter] @ui suite selection is implausibly low: ${selected} of ${total} ` +
        `(floor ${min}). A drop this large signals a mis-selection like #9586's 91-of-422, ` +
        `not normal churn. If the suite legitimately shrank, lower the minSelected floor.`,
    );
  }
  if (selected >= total) {
    throw new Error(
      `[uiSuiteReporter] @ui selection excluded nothing: ${selected} of ${total} selected. ` +
        `The @${EXCLUDE_TAGS.join('/@')} filter did not run — selection is not trustworthy.`,
    );
  }
}

/**
 * Playwright reporter that performs @ui-suite selection in `preprocess()`.
 *
 * Registered in `playwright.ci.config.ts`; a no-op unless `PW_UI_SUITE=1`
 * (or `enabled: true`) so the shared @api job is unaffected.
 */
export default class UiSuiteReporter implements Reporter {
  private readonly options: UiSuiteReporterConfig;

  constructor(options: UiSuiteReporterConfig = {}) {
    this.options = options;
  }

  private isEnabled(): boolean {
    if (typeof this.options.enabled === 'boolean') {
      return this.options.enabled;
    }
    return process.env[UI_SUITE_ENV_FLAG] === '1';
  }

  async preprocess(params: { suite: Suite; testRun: TestRun }): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    const all: TestCase[] = params.suite.allTests();
    const { selected, excluded } = partitionUiSuite(all);
    // Assert BEFORE mutating the run so a bad selection fails loudly and early.
    assertPlausibleSelection(
      { selected: selected.length, total: all.length },
      this.options,
    );
    for (const test of excluded) {
      params.testRun.exclude(test);
    }
    // The selection summary is the point of the reporter — a silent selector is exactly #9586.
    console.log(
      `[uiSuiteReporter] selected ${selected.length} @ui tests, excluded ${excluded.length} of ${all.length}.`,
    );
  }

  printsToStdio(): boolean {
    // Emits one summary line; declaring true keeps Playwright from adding its own noise.
    return true;
  }
}
