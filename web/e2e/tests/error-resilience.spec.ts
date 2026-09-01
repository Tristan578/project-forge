import { test, expect } from '../fixtures/editor.fixture';
import { E2E_TIMEOUT_SHORT_MS, E2E_TIMEOUT_ELEMENT_MS, E2E_TIMEOUT_LOAD_MS, E2E_TIMEOUT_NAV_MS } from '../constants';

/**
 * Error resilience E2E tests.
 * Verifies the editor handles errors gracefully without crashing,
 * including store corruption attempts, rapid interactions, and
 * console error monitoring.
 */
test.describe('Error Resilience @ui @dev', () => {
  test.describe('Console Error Monitoring', () => {
    test('editor loads without critical JS errors @engine-ui', async ({ page, editor }) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          const lower = text.toLowerCase();
          // Ignore known harmless errors
          const ignored = [
            'favicon', '404', 'clerk', '__skip_engine', 'middleware',
            'auth', 'internal server error', 'hydration', 'failed to fetch',
            'api/tokens', 'server error', 'next-', 'hmr', 'webpack',
          ];
          if (!ignored.some((p) => lower.includes(p))) {
            errors.push(text);
          }
        }
      });

      await editor.load();

      // Wait for deferred async initialisation to settle before checking errors.
      //
      // This used `waitForLoadState('networkidle')`, which worked only while
      // this spec ran without an engine. With a real engine the network never
      // goes quiet for 500ms and the wait times out at 30s instead.
      //
      // The canvas is a stronger signal anyway: CanvasArea keeps it
      // `invisible` until the first frame is drawn, so its becoming visible
      // means the engine actually finished starting — where networkidle was
      // only ever a proxy for that.
      await expect(page.locator('canvas').first()).toBeVisible({
        timeout: E2E_TIMEOUT_LOAD_MS,
      });

      expect(errors).toEqual([]);
    });

    test('no unhandled promise rejections on load', async ({ page, editor }) => {
      const rejections: string[] = [];
      page.on('pageerror', (error) => {
        const msg = error.message.toLowerCase();
        // Ignore Clerk and auth-related errors
        if (!msg.includes('clerk') && !msg.includes('auth') && !msg.includes('next')) {
          rejections.push(error.message);
        }
      });

      await editor.loadPage();
      // Wait for any async effects to complete before asserting no rejections.
      // Same reason as above: with an engine running, networkidle never fires.
      // The canvas turning visible is the first-frame signal.
      await expect(page.locator('canvas').first()).toBeVisible({
        timeout: E2E_TIMEOUT_LOAD_MS,
      });

      expect(rejections).toEqual([]);
    });
  });

  test.describe('Store Resilience', () => {
    test.beforeEach(async ({ editor }) => {
      await editor.loadPage();
    });

    test('store survives invalid setState calls', async ({ page }) => {
      // Attempt to set invalid state
      await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        if (!store) return;
        // Try setting an invalid mode — store should handle gracefully
        try {
          store.setState({ engineMode: 'invalid_mode' });
        } catch {
          // Expected to fail or be ignored
        }
      });

      // Store should still be accessible
      const storeExists = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        return !!store && typeof store.getState === 'function';
      });
      expect(storeExists).toBe(true);
    });

    test('scene graph survives empty node injection', async ({ page }) => {
      await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        if (!store) return;
        const state = store.getState();
        // Set scene graph with empty nodes
        store.setState({
          sceneGraph: {
            nodes: {},
            rootIds: [],
          },
          selectedIds: state.selectedIds || new Set(),
        });
      });

      // UI should not crash — hierarchy should render (possibly empty)
      const storeOk = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        const state = store?.getState();
        return state?.sceneGraph?.nodes !== undefined;
      });
      expect(storeOk).toBe(true);
    });

    test('rapid mode transitions do not corrupt state', async ({ page }) => {
      const modes = ['edit', 'play', 'paused', 'edit', 'play', 'edit'];
      for (const mode of modes) {
        await page.evaluate((m) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__EDITOR_STORE?.setState({ engineMode: m });
        }, mode);
      }

      const finalMode = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (window as any).__EDITOR_STORE?.getState()?.engineMode;
      });
      expect(finalMode).toBe('edit');
    });
  });

  test.describe('UI Interaction Resilience', () => {
    test.beforeEach(async ({ editor }) => {
      await editor.loadPage();
    });

    test('rapid button clicks do not crash @engine-ui', async ({ page, editor }) => {
      await editor.load();
      const addEntityBtn = page.getByRole('button', { name: 'Add Entity' });
      if (await addEntityBtn.isVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS })) {
        // Click rapidly 5 times
        for (let i = 0; i < 5; i++) {
          await addEntityBtn.click();
          await page.keyboard.press('Escape');
        }
      }

      // Editor should still be functional
      await expect(page.locator('canvas').first()).toBeVisible();
    });

    test('opening and closing settings rapidly does not crash @engine-ui', async ({ page, editor }) => {
      await editor.load();
      const settingsBtn = page.locator('button[title="Settings"]').first();
      await expect(settingsBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

      for (let i = 0; i < 3; i++) {
        await settingsBtn.click();
        await expect(page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]')).toBeVisible({ timeout: E2E_TIMEOUT_SHORT_MS });
        await page.keyboard.press('Escape');
        await expect(page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]')).not.toBeVisible({ timeout: E2E_TIMEOUT_SHORT_MS });
      }

      // Editor canvas should still be visible
      await expect(page.locator('canvas').first()).toBeVisible();
    });

    test('window resize does not crash the editor @engine-ui', async ({ page, editor }) => {
      await editor.load();
      // Resize to mobile width
      await page.setViewportSize({ width: 375, height: 667 });
      // Wait for the canvas to remain visible at the new viewport before resizing again
      await expect(page.locator('canvas').first()).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

      // Resize back to desktop
      await page.setViewportSize({ width: 1280, height: 720 });

      // Editor should still be functional
      await expect(page.locator('canvas').first()).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    });

    test('double-clicking on canvas does not produce errors @engine-ui', async ({ page, editor }) => {
      await editor.load();
      const errors: string[] = [];
      page.on('pageerror', (error) => {
        errors.push(error.message);
      });

      const canvas = page.locator('canvas').first();
      await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

      await canvas.dblclick();
      // Give any async handler the click triggered a chance to throw.
      //
      // networkidle was used here and cannot settle while the engine is
      // running. There is no event that means "the click's handlers are done",
      // so this waits a bounded moment and then asserts. Kept short
      // deliberately: a pageerror from a click surfaces on the next tick or
      // two, and a longer wait would buy nothing but wall-clock.
      await page.waitForTimeout(1000);

      // Filter out known harmless errors
      const criticalErrors = errors.filter(
        (e) => !e.toLowerCase().includes('clerk') && !e.toLowerCase().includes('auth'),
      );
      expect(criticalErrors).toEqual([]);
    });
  });

  test.describe('Network Resilience', () => {
    test('editor loads even when API endpoints are slow @engine-ui', async ({ page, editor }) => {
      // Slow down API responses
      await page.route('**/api/**', async (route) => {
        // Add 100ms delay but don't block
        await new Promise((r) => setTimeout(r, 100));
        await route.continue();
      });

      await editor.load();

      // Editor should still render
      await expect(page.locator('canvas').first()).toBeVisible({ timeout: E2E_TIMEOUT_NAV_MS });
    });
  });
});
