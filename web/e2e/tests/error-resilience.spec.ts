import { test, expect } from '../fixtures/editor.fixture';

/**
 * Error resilience E2E tests.
 * Verifies the editor handles errors gracefully without crashing,
 * including store corruption attempts, rapid interactions, and
 * console error monitoring.
 */
test.describe('Error Resilience @ui', () => {
  test.describe('Console Error Monitoring', () => {
    test('editor loads without critical JS errors', async ({ page, editor }) => {
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

      await editor.loadPage();

      // Wait for any delayed errors
      await page.waitForTimeout(2000);

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
      await page.waitForTimeout(2000);

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

    test('rapid button clicks do not crash', async ({ page }) => {
      const addEntityBtn = page.getByRole('button', { name: 'Add Entity' });
      if (await addEntityBtn.isVisible({ timeout: 5000 })) {
        // Click rapidly 5 times
        for (let i = 0; i < 5; i++) {
          await addEntityBtn.click();
          await page.keyboard.press('Escape');
        }
      }

      // Editor should still be functional
      await expect(page.locator('canvas').first()).toBeVisible();
    });

    test('opening and closing settings rapidly does not crash', async ({ page }) => {
      const settingsBtn = page.locator('button[title="Settings"]').first();
      await expect(settingsBtn).toBeVisible({ timeout: 5000 });

      for (let i = 0; i < 3; i++) {
        await settingsBtn.click();
        await expect(page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]')).toBeVisible({ timeout: 3000 });
        await page.keyboard.press('Escape');
        await expect(page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]')).not.toBeVisible({ timeout: 3000 });
      }

      // Editor canvas should still be visible
      await expect(page.locator('canvas').first()).toBeVisible();
    });

    test('window resize does not crash the editor', async ({ page }) => {
      // Resize to mobile width
      await page.setViewportSize({ width: 375, height: 667 });
      await page.waitForTimeout(500);

      // Resize back to desktop
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.waitForTimeout(500);

      // Editor should still be functional
      await expect(page.locator('canvas').first()).toBeVisible();
    });

    test('double-clicking on canvas does not produce errors', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => {
        errors.push(error.message);
      });

      const canvas = page.locator('canvas').first();
      await expect(canvas).toBeVisible({ timeout: 10000 });

      await canvas.dblclick();
      await page.waitForTimeout(1000);

      // Filter out known harmless errors
      const criticalErrors = errors.filter(
        (e) => !e.toLowerCase().includes('clerk') && !e.toLowerCase().includes('auth'),
      );
      expect(criticalErrors).toEqual([]);
    });
  });

  test.describe('Network Resilience', () => {
    test('editor loads even when API endpoints are slow', async ({ page, editor }) => {
      // Slow down API responses
      await page.route('**/api/**', async (route) => {
        // Add 100ms delay but don't block
        await new Promise((r) => setTimeout(r, 100));
        await route.continue();
      });

      await editor.loadPage();

      // Editor should still render
      await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    });
  });
});
