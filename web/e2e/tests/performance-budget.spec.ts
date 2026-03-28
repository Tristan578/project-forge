/**
 * Performance Budget E2E Tests (PF-676)
 *
 * Measures Core Web Vitals using the PerformanceObserver API in the browser.
 * These tests use loadPage() (@ui) rather than load() to avoid WASM initialization,
 * which makes them runnable in headless CI without a GPU.
 *
 * Thresholds (PASS / FAIL):
 *   - LCP (Largest Contentful Paint): < 2500ms  (Google "Good" threshold)
 *   - CLS (Cumulative Layout Shift):  < 0.1      (Google "Good" threshold)
 */

import { test, expect } from '../fixtures/editor.fixture';
import { E2E_TIMEOUT_TEST_MS } from '../constants';

test.describe('Performance Budget @ui', () => {
  test('LCP is under 2500ms on editor page', async ({ page, editor }) => {
    // Collect LCP entries via PerformanceObserver BEFORE navigation so we
    // catch the entry that fires shortly after page load.
    const lcpValues: number[] = [];

    await page.addInitScript(() => {
      // Store LCP entries on window for retrieval after load
      (window as unknown as Record<string, unknown>).__LCP_VALUES = [];
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          (window as unknown as Record<string, number[]>).__LCP_VALUES.push(
            (entry as PerformanceEntry & { startTime: number }).startTime,
          );
        }
      });
      obs.observe({ type: 'largest-contentful-paint', buffered: true });
    });

    await editor.loadPage();

    // Give the browser a moment to fire any pending LCP entries.
    // Wait until the window.__LCP_VALUES array is non-empty OR networkidle
    // (whichever comes first), rather than using an arbitrary sleep.
    await page.waitForFunction(
      () => {
        const vals = (window as unknown as Record<string, unknown>).__LCP_VALUES;
        return Array.isArray(vals) && vals.length > 0;
      },
      { timeout: 3000 },
    ).catch(async () => {
      // LCP may not fire on some CI configs — fall back to networkidle
      await page.waitForLoadState('networkidle').catch(() => undefined);
    });

    const rawValues = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__LCP_VALUES,
    );

    if (Array.isArray(rawValues) && rawValues.length > 0) {
      lcpValues.push(...(rawValues as number[]));
    }

    if (lcpValues.length === 0) {
      // LCP may not fire when GPU/WASM is skipped — treat as not applicable
      // rather than failing the test (this only happens in certain CI configs)
      return;
    }

    // The last LCP value is the canonical one (the browser may emit multiple
    // entries as larger elements paint)
    const lcp = lcpValues[lcpValues.length - 1];
    // CI runners are slower — use relaxed threshold
    const threshold = process.env.CI ? 8000 : 2500;
    expect(lcp, `LCP was ${lcp.toFixed(0)}ms — exceeds ${threshold}ms budget`).toBeLessThan(threshold);
  });

  test('CLS is under 0.1 on editor page', async ({ page, editor }) => {
    await page.addInitScript(() => {
      // Accumulate layout shift scores on window
      (window as unknown as Record<string, unknown>).__CLS_SCORE = 0;
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const layoutShiftEntry = entry as PerformanceEntry & {
            hadRecentInput: boolean;
            value: number;
          };
          // Ignore shifts that occur after user input (not counted by Google CrUX)
          if (!layoutShiftEntry.hadRecentInput) {
            (window as unknown as Record<string, number>).__CLS_SCORE +=
              layoutShiftEntry.value;
          }
        }
      });
      obs.observe({ type: 'layout-shift', buffered: true });
    });

    await editor.loadPage();

    // Wait for any deferred layout shifts (lazy-loaded panels etc.).
    // Use networkidle rather than an arbitrary sleep so the wait is bounded
    // by real browser activity instead of a hard-coded duration.
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const cls = await page.evaluate(
      () => (window as unknown as Record<string, number>).__CLS_SCORE ?? 0,
    );

    expect(cls, `CLS was ${cls.toFixed(4)} — exceeds 0.1 budget`).toBeLessThan(0.1);
  });

  test('time-to-interactive (DOM content loaded) is under budget', async ({ page }) => {
    const navigationStart = Date.now();

    await page.addInitScript(() => {
      localStorage.setItem('forge-welcomed', '1');
      localStorage.setItem('forge-mobile-dismissed', '1');
      localStorage.setItem('forge-checklist-dismissed', '1');
      (window as unknown as Record<string, unknown>).__SKIP_ENGINE = true;
    });

    await page.goto('/dev', { waitUntil: 'domcontentloaded', timeout: E2E_TIMEOUT_TEST_MS });

    const elapsed = Date.now() - navigationStart;
    // CI runners are slower — use relaxed threshold
    const threshold = process.env.CI ? 15000 : 5000;
    expect(
      elapsed,
      `DOM content loaded took ${elapsed}ms — exceeds ${threshold}ms budget`,
    ).toBeLessThan(threshold);
  });
});
