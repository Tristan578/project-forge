import { test, expect } from '../fixtures/editor.fixture';

/**
 * Editor boot gate — verifies the editor shell loads and React hydrates
 * without fatal errors. Tagged @smoke so CI can target it cheaply.
 *
 * Uses loadPage() (not load()) so no WASM build is required — the engine
 * is skipped via __SKIP_ENGINE and the test validates the React shell only.
 * This is the minimum bar: if the page can't hydrate, nothing else matters.
 */
test.describe('Editor Boot @smoke', () => {
  test('editor shell hydrates without JavaScript errors', async ({ page, editor }) => {
    const jsErrors: string[] = [];

    page.on('pageerror', (err) => {
      jsErrors.push(err.message);
    });

    await editor.loadPage();

    expect(jsErrors, `Unexpected JS errors: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('editor layout container is present after hydration', async ({ editor, page }) => {
    await editor.loadPage();

    // The dockview container is the root of the editor layout.
    // Its presence confirms EditorLayout mounted and rendered successfully.
    const container = page.locator('.dv-dockview-container').first();
    await expect(container).toBeVisible({ timeout: 10_000 });
  });

  test('no fatal console errors during boot', async ({ page, editor }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await editor.loadPage();

    // Filter out known non-fatal browser noise (e.g. extension injections).
    // We only fail on errors that originate from the app itself.
    //
    // CSP violations for Vercel Analytics / Speed Insights scripts are excluded:
    // the app's CSP intentionally does not whitelist va.vercel-scripts.com —
    // those are third-party telemetry scripts that inject only in Vercel
    // preview/production deployments. Blocking them is correct and has no
    // effect on editor functionality.
    const appErrors = consoleErrors.filter(
      (msg) =>
        !msg.includes('favicon') &&
        !msg.includes('chrome-extension') &&
        !msg.includes('moz-extension') &&
        !msg.includes('Content Security Policy'),
    );

    expect(appErrors, `Console errors during boot: ${appErrors.join('\n')}`).toHaveLength(0);
  });

  test('editor store is accessible after hydration', async ({ editor }) => {
    await editor.loadPage();

    // __EDITOR_STORE is set in EditorLayout on mount.
    // Its presence confirms Zustand store initialised correctly.
    await editor.waitForEditorStore(10_000);
  });
});
