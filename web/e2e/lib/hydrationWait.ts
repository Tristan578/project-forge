import { E2E_HYDRATION_TIMEOUT_MS } from '../../src/lib/config/timeouts';
import { E2E_TIMEOUT_TEST_MARGIN_MS } from '../constants';

/**
 * How long `waitForEditorHydration` (e2e/fixtures/editor.fixture.ts) may wait
 * for `__REACT_HYDRATED`, given the running test's timeout and how much of it
 * has already been spent.
 *
 * The rule: `E2E_HYDRATION_TIMEOUT_MS` or the test's REMAINING budget minus
 * `E2E_TIMEOUT_TEST_MARGIN_MS`, whichever is smaller. Sizing from the time
 * remaining rather than the full timeout is the point — fixture setup,
 * `beforeEach` hooks, `page.goto(..., { waitUntil: 'commit' })` and
 * `waitForLoadState('domcontentloaded')` all run before the wait starts, and
 * a wait sized to the full timeout would outlive the test by exactly that
 * much, dying as the generic "Test timeout of Nms exceeded" instead of on its
 * own line.
 *
 * When the remaining budget is not positive the full hydration budget applies.
 * That covers a test with no timeout (`test.setTimeout(0)`, `--timeout=0`,
 * where `test.info().timeout` is 0) and one too short to hold the margin at
 * all; in the latter case the test's own timeout fires first, which is the
 * only thing a non-positive wait could do anyway. A negative `elapsedMs` (a
 * stamp from a clock that went backwards) counts as 0. Non-finite input also
 * takes the fallback rather than producing `NaN`.
 *
 * Pure so it can be unit-tested without Playwright:
 * `e2e/lib/__tests__/hydrationWait.test.ts`.
 */
export function hydrationWaitMs(testTimeoutMs: number, elapsedMs: number): number {
  if (!Number.isFinite(testTimeoutMs) || !Number.isFinite(elapsedMs)) {
    return E2E_HYDRATION_TIMEOUT_MS;
  }
  const remainingMs = testTimeoutMs - Math.max(0, elapsedMs) - E2E_TIMEOUT_TEST_MARGIN_MS;
  return remainingMs > 0 ? Math.min(E2E_HYDRATION_TIMEOUT_MS, remainingMs) : E2E_HYDRATION_TIMEOUT_MS;
}
