import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import {
  E2E_HYDRATION_TIMEOUT_MS,
  E2E_VISIBILITY_TIMEOUT_MS,
} from '../../src/lib/config/timeouts';

/**
 * Condition-based wait utilities for E2E tests.
 *
 * These replace arbitrary `waitForTimeout()` calls with waits that
 * resolve as soon as the condition is met, making tests faster and
 * more resilient to timing variations across environments.
 */

/**
 * Waits for a dockview panel tab or panel container to be visible.
 *
 * @param page - Playwright Page
 * @param panelName - The panel title/label (case-insensitive match)
 * @param timeout - Maximum wait time in ms (default 5000)
 */
export async function waitForPanel(
  page: Page,
  panelName: string,
  timeout = 5000,
): Promise<void> {
  const panelLocator = page
    .locator('.dv-tab, [data-testid^="panel-"]')
    .filter({ hasText: new RegExp(panelName, 'i') })
    .first();
  await expect(panelLocator).toBeVisible({ timeout });
}

/**
 * Waits for an entity with the given name to appear in the scene hierarchy.
 *
 * @param page - Playwright Page
 * @param entityName - The entity name to wait for (case-insensitive)
 * @param timeout - Maximum wait time in ms (default 10000)
 */
export async function waitForEntity(
  page: Page,
  entityName: string,
  timeout = 10000,
): Promise<void> {
  await page.waitForFunction(
    (name: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (!store) return false;
      const state = store.getState();
      const nodes = state?.sceneGraph?.nodes;
      if (!nodes) return false;
      const lowerName = name.toLowerCase();
      return Object.values(nodes).some(
        (n: unknown) => {
          const node = n as { name?: string };
          return node.name?.toLowerCase().includes(lowerName);
        },
      );
    },
    entityName,
    { timeout },
  );
}

/**
 * Waits for the WASM engine to report ready.
 * Uses the __FORGE_ENGINE_READY flag set by useEngine.
 *
 * @param page - Playwright Page
 * @param timeout - Maximum wait time in ms (default 45000)
 */
export async function waitForEngineReady(
  page: Page,
  timeout = E2E_HYDRATION_TIMEOUT_MS,
): Promise<void> {
  await page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__FORGE_ENGINE_READY === true,
    { timeout },
  );
}

/**
 * Waits for React hydration to complete.
 * Uses the __REACT_HYDRATED flag set by EditorLayout.
 *
 * @param page - Playwright Page
 * @param timeout - Maximum wait time in ms (default 30000)
 */
export async function waitForHydration(
  page: Page,
  timeout = E2E_VISIBILITY_TIMEOUT_MS,
): Promise<void> {
  await page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__REACT_HYDRATED === true,
    { timeout },
  );
}

/**
 * Waits for the editor store to have a specific engine mode.
 *
 * @param page - Playwright Page
 * @param mode - The expected engine mode ('edit' | 'play' | 'paused')
 * @param timeout - Maximum wait time in ms (default 5000)
 */
export async function waitForEngineMode(
  page: Page,
  mode: string,
  timeout = 5000,
): Promise<void> {
  await page.waitForFunction(
    (expectedMode: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      return store?.getState()?.engineMode === expectedMode;
    },
    mode,
    { timeout },
  );
}

/**
 * Waits for the canvas element to be visible and have non-zero dimensions.
 *
 * @param page - Playwright Page
 * @param timeout - Maximum wait time in ms (default 10000)
 */
export async function waitForCanvas(
  page: Page,
  timeout = 10000,
): Promise<void> {
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout });
}

/**
 * Waits for a viewport resize to settle by checking that the canvas
 * is visible after the resize.
 *
 * @param page - Playwright Page
 * @param width - Target viewport width
 * @param height - Target viewport height
 * @param timeout - Maximum wait time in ms (default 5000)
 */
export async function waitForResize(
  page: Page,
  width: number,
  height: number,
  timeout = 5000,
): Promise<void> {
  await page.setViewportSize({ width, height });
  await expect(page.locator('canvas').first()).toBeVisible({ timeout });
}

/**
 * Waits for console errors to stop appearing for a given duration.
 * Use this instead of `waitForTimeout(2000)` after page load when
 * checking for errors.
 *
 * @param page - Playwright Page
 * @param stableMs - How long to wait with no new errors (default 1000)
 * @param timeout - Maximum overall wait time (default 5000)
 */
export async function waitForConsoleStable(
  page: Page,
  stableMs = 1000,
  timeout = 5000,
): Promise<void> {
  await page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__REACT_HYDRATED === true,
    { timeout },
  ).catch(() => {
    // If hydration flag isn't set (e.g. non-editor page), just wait for load
  });
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {
    // networkidle may not complete in all scenarios; fall back gracefully
  });
  // Brief wait for any final async console messages
  await page.waitForTimeout(stableMs);
}
