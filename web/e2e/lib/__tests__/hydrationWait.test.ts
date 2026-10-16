/**
 * @vitest-environment node
 *
 * `hydrationWaitMs` — the arithmetic behind `waitForEditorHydration`
 * (e2e/fixtures/editor.fixture.ts), kept pure so this suite needs no
 * Playwright. The expected values below are written out as numbers on purpose:
 * each is what the shipped constants (45s hydration budget, 2s margin) give for
 * one real config, so a change to either constant has to come back here and
 * say what the new ceilings are.
 */
import { describe, expect, it } from 'vitest';

import { E2E_HYDRATION_TIMEOUT_MS } from '../../../src/lib/config/timeouts';
import { E2E_TIMEOUT_TEST_MARGIN_MS } from '../../constants';
import { hydrationWaitMs } from '../hydrationWait';

describe('hydrationWaitMs', () => {
  it('is computed against the constants this table assumes', () => {
    expect(E2E_HYDRATION_TIMEOUT_MS).toBe(45_000);
    expect(E2E_TIMEOUT_TEST_MARGIN_MS).toBe(2_000);
  });

  it.each([
    // [testTimeoutMs, elapsedMs, expected]
    [30_000, 0, 28_000], // playwright.ci.config.ts: budget minus margin
    [45_000, 0, 43_000], // playwright.journey.config.ts: budget minus margin
    [60_000, 0, 45_000], // playwright.config.ts: the hydration budget wins
    [90_000, 0, 45_000], // playwright.engine.config.ts: the hydration budget wins
    [0, 0, 45_000], // no timeout (test.setTimeout(0) / --timeout=0): full budget
    [1_500, 0, 45_000], // too short to hold the margin: full budget, test timeout fires first
  ])('timeout %d at elapsed %d waits %d', (testTimeoutMs, elapsedMs, expected) => {
    expect(hydrationWaitMs(testTimeoutMs, elapsedMs)).toBe(expected);
  });

  it('subtracts the time already spent from the remaining budget', () => {
    // 30s ci test, 5s already gone: 30000 - 5000 - 2000.
    expect(hydrationWaitMs(30_000, 5_000)).toBe(23_000);
  });

  it('falls back to the full budget when the remaining time cannot hold the margin', () => {
    // 30s ci test, 29s already gone: 30000 - 29000 - 2000 < 0.
    expect(hydrationWaitMs(30_000, 29_000)).toBe(E2E_HYDRATION_TIMEOUT_MS);
    // Exactly the margin left is still not positive.
    expect(hydrationWaitMs(30_000, 28_000)).toBe(E2E_HYDRATION_TIMEOUT_MS);
    // One millisecond more than the margin is.
    expect(hydrationWaitMs(30_000, 27_999)).toBe(1);
  });

  it('treats a negative elapsed time as zero', () => {
    expect(hydrationWaitMs(30_000, -5_000)).toBe(28_000);
  });

  it('takes the fallback for non-finite input instead of returning NaN', () => {
    expect(hydrationWaitMs(Number.NaN, 0)).toBe(E2E_HYDRATION_TIMEOUT_MS);
    expect(hydrationWaitMs(30_000, Number.NaN)).toBe(E2E_HYDRATION_TIMEOUT_MS);
    expect(hydrationWaitMs(Number.POSITIVE_INFINITY, 0)).toBe(E2E_HYDRATION_TIMEOUT_MS);
  });

  it('never exceeds the hydration budget, and never the remaining budget when that is positive', () => {
    for (let testTimeoutMs = 0; testTimeoutMs <= 120_000; testTimeoutMs += 1_000) {
      for (let elapsedMs = 0; elapsedMs <= testTimeoutMs; elapsedMs += 1_000) {
        const wait = hydrationWaitMs(testTimeoutMs, elapsedMs);
        expect(wait).toBeGreaterThan(0);
        expect(wait).toBeLessThanOrEqual(E2E_HYDRATION_TIMEOUT_MS);
        const remainingMs = testTimeoutMs - elapsedMs - E2E_TIMEOUT_TEST_MARGIN_MS;
        if (remainingMs > 0) expect(wait).toBeLessThanOrEqual(remainingMs);
      }
    }
  });
});
