/**
 * Theme Effects E2E tests — @ui tag
 *
 * Verifies that ThemeAmbient renders the correct effect element for each theme,
 * respects data-sf-effects="off", and respects prefers-reduced-motion.
 *
 * NOTE: These tests manipulate DOM attributes directly via page.evaluate()
 * and do NOT require the WASM engine to be initialized.
 */
import { test, expect } from '../fixtures/editor.fixture';

const LIGHT_THEMES = ['ember', 'ice', 'leaf', 'rust', 'mech', 'light'] as const;

test.describe('Theme Effects @ui @dev', () => {
  test.beforeEach(async ({ editor }) => {
    // Theme-effects tests only need DOM/CSS — no WASM engine required.
    // loadPage() injects __SKIP_ENGINE=true and waits for React hydration only,
    // which works in CI headless Chrome (--disable-gpu blocks engine init).
    await editor.loadPage();
  });

  test('dark theme has no effect element', async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-sf-theme', 'dark');
      document.documentElement.setAttribute('data-sf-effects', 'on');
    });
    // Wait until React has removed any prior effect element before asserting absence
    await page.waitForFunction(() => !document.querySelector('[data-sf-effect]'));
    const effect = page.locator('[data-sf-effect]');
    await expect(effect).toHaveCount(0);
  });

  for (const theme of LIGHT_THEMES) {
    test(`${theme} theme renders effect element`, async ({ page }) => {
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-sf-theme', t);
        document.documentElement.setAttribute('data-sf-effects', 'on');
      }, theme);

      const effect = page.locator(`[data-sf-effect="${theme}"]`);
      await expect(effect).toBeVisible({ timeout: 5000 });

      // Verify pointer-events: none (so effect doesn't block interactions)
      const pe = await effect.evaluate((el) => getComputedStyle(el).pointerEvents);
      expect(pe).toBe('none');

      // Verify z-index = 5 (effects layer)
      const zi = await effect.evaluate((el) => getComputedStyle(el).zIndex);
      expect(zi).toBe('5');
    });
  }

  test('effects disabled when data-sf-effects=off', async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-sf-theme', 'ember');
      document.documentElement.setAttribute('data-sf-effects', 'off');
    });
    // Wait until React has removed any prior effect element before asserting absence
    await page.waitForFunction(() => !document.querySelector('[data-sf-effect]'));
    const effect = page.locator('[data-sf-effect]');
    await expect(effect).toHaveCount(0);
  });

  test('prefers-reduced-motion disables effects', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-sf-theme', 'ember');
      document.documentElement.setAttribute('data-sf-effects', 'on');
    });
    // Wait until React has removed any prior effect element before asserting absence
    await page.waitForFunction(() => !document.querySelector('[data-sf-effect]'));
    const effect = page.locator('[data-sf-effect]');
    await expect(effect).toHaveCount(0);
  });

  test('switching from dark to ember renders effect', async ({ page }) => {
    // Start dark (no effect)
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-sf-theme', 'dark');
      document.documentElement.setAttribute('data-sf-effects', 'on');
    });
    await page.waitForFunction(() => !document.querySelector('[data-sf-effect]'));
    await expect(page.locator('[data-sf-effect]')).toHaveCount(0);

    // Switch to ember
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-sf-theme', 'ember');
    });

    // Effect should appear
    await expect(page.locator('[data-sf-effect="ember"]')).toBeVisible({ timeout: 3000 });
  });
});
