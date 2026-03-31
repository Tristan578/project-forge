import { test, expect } from '../fixtures/editor.fixture';
import { E2E_TIMEOUT_ELEMENT_MS } from '../constants';

/**
 * PF-690: Load budget performance tests.
 *
 * Measures time-to-interactive (editor canvas visible) and JS heap memory
 * after the editor loads. Budgets are sourced from performanceTargets.ts.
 *
 * Tagged @ui @slow — runs in Chromium only (needs performance.memory API).
 * Uses loadPage() (no WASM engine) to measure pure React load time.
 */

// performanceTargets.ts is a TS module with path aliases — E2E tests run
// outside the bundler, so we duplicate the numeric values here.
// Source of truth: web/src/lib/config/performanceTargets.ts
const EDITOR_TTI_CI_MS = 5_000;
const EDITOR_HEAP_BUDGET_MB = 150;

test.describe('Editor Load Budget @ui @slow', () => {
  // fixme: CI runners consistently exceed TTI budget. Needs CI-aware threshold or skip.
  test.fixme(`time to interactive is under ${EDITOR_TTI_CI_MS}ms`, async ({ page, editor }) => {
    const start = Date.now();

    await editor.loadPage();

    // Canvas should be visible — proxy for the editor being interactive
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    const tti = Date.now() - start;
    expect(tti).toBeLessThan(EDITOR_TTI_CI_MS);
  });

  test(`JS heap memory after load is under ${EDITOR_HEAP_BUDGET_MB}MB`, async ({ page, editor }) => {
    await editor.loadPage();

    // performance.memory is a Chromium-only non-standard extension.
    // Returns undefined in Firefox/Safari — skip gracefully in those browsers.
    const heapBytes = await page.evaluate(
      () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
    );

    if (heapBytes === undefined) {
      // Browser does not expose performance.memory — skip assertion
      return;
    }

    const heapMB = heapBytes / (1024 * 1024);
    expect(heapMB).toBeLessThan(EDITOR_HEAP_BUDGET_MB);
  });
});
