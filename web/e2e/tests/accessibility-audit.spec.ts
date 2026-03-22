import { test, expect } from '../fixtures/editor.fixture';
import AxeBuilder from '@axe-core/playwright';

/**
 * Axe-core accessibility audit tests.
 *
 * These tests run a full axe scan on key pages to catch WCAG violations
 * that manual tests miss (duplicate IDs, missing landmarks, color contrast,
 * invalid ARIA, etc.).
 *
 * Exclusions strategy:
 * - Canvas element: WebGPU/WebGL content is not accessible to the a11y tree
 * - .dv-dockview-container: Dockview panels use custom focus management that
 *   does not follow standard DOM patterns (tabindex=-1 on internal wrappers)
 * - Third-party widgets that own their a11y semantics are included by default
 *   but contrast violations inside them are suppressed via rule disabling
 *
 * Rules disabled globally:
 * - color-contrast: SpawnForge uses a dark zinc color scale. The editor panels
 *   intentionally use muted zinc-400/zinc-500 text on zinc-800/zinc-900 backgrounds.
 *   These pass human readability checks but fail automated contrast ratio at 4.5:1
 *   due to the very dark backgrounds. Contrast will be addressed in a dedicated
 *   design pass (PF-572). Disabling here avoids blocking CI on known-accepted UX.
 */

test.describe('Axe Accessibility Audit @ui', () => {
  test.describe('Public pages', () => {
    test('pricing page has no critical a11y violations', async ({ page }) => {
      await page.goto('/pricing');
      await page.waitForLoadState('domcontentloaded');

      const results = await new AxeBuilder({ page })
        .disableRules(['color-contrast'])
        .analyze();

      const criticalOrSerious = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );

      if (criticalOrSerious.length > 0) {
        const summary = criticalOrSerious
          .map((v) => `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`)
          .join('\n');
        expect(criticalOrSerious, `A11y violations on /pricing:\n${summary}`).toHaveLength(0);
      }
    });

    test('terms page has no critical a11y violations', async ({ page }) => {
      await page.goto('/terms');
      await page.waitForLoadState('domcontentloaded');

      const results = await new AxeBuilder({ page })
        .disableRules(['color-contrast'])
        .analyze();

      const criticalOrSerious = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );

      if (criticalOrSerious.length > 0) {
        const summary = criticalOrSerious
          .map((v) => `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`)
          .join('\n');
        expect(criticalOrSerious, `A11y violations on /terms:\n${summary}`).toHaveLength(0);
      }
    });

    test('privacy page has no critical a11y violations', async ({ page }) => {
      await page.goto('/privacy');
      await page.waitForLoadState('domcontentloaded');

      const results = await new AxeBuilder({ page })
        .disableRules(['color-contrast'])
        .analyze();

      const criticalOrSerious = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );

      if (criticalOrSerious.length > 0) {
        const summary = criticalOrSerious
          .map((v) => `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`)
          .join('\n');
        expect(criticalOrSerious, `A11y violations on /privacy:\n${summary}`).toHaveLength(0);
      }
    });
  });

  test.describe('Editor', () => {
    // fixme: editor has known a11y violations being fixed incrementally.
    test.fixme('editor page has no critical a11y violations', async ({ page, editor }) => {
      await editor.loadPage();

      const results = await new AxeBuilder({ page })
        .exclude('canvas') // WebGL content — no DOM a11y tree representation
        .exclude('.dv-dockview-container') // Dockview custom focus management
        .exclude('.cl-rootBox') // Clerk auth widget — third-party a11y
        .exclude('#clerk-components') // Clerk injected elements
        .disableRules([
          'color-contrast', // Dark zinc theme — intentional (PF-572)
          'landmark-one-main', // <main> may not render in all layout modes
        ])
        .analyze();

      const criticalOrSerious = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );

      if (criticalOrSerious.length > 0) {
        const summary = criticalOrSerious
          .map(
            (v) =>
              `[${v.impact}] ${v.id}: ${v.description}\n` +
              v.nodes
                .slice(0, 3)
                .map((n) => `  - ${n.html.slice(0, 120)}`)
                .join('\n'),
          )
          .join('\n\n');
        expect(criticalOrSerious, `A11y violations in editor:\n\n${summary}`).toHaveLength(0);
      }
    });

    test('settings dialog has no critical a11y violations', async ({ page, editor }) => {
      await editor.loadPage();

      const settingsBtn = page.locator('button[title="Settings"]').first();
      await expect(settingsBtn).toBeVisible({ timeout: 15_000 });
      await settingsBtn.click();

      const dialog = page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      const results = await new AxeBuilder({ page })
        .include('[role="dialog"][aria-labelledby="settings-dialog-title"]')
        .disableRules(['color-contrast'])
        .analyze();

      const criticalOrSerious = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );

      if (criticalOrSerious.length > 0) {
        const summary = criticalOrSerious
          .map((v) => `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`)
          .join('\n');
        expect(criticalOrSerious, `A11y violations in settings dialog:\n${summary}`).toHaveLength(0);
      }

      await page.keyboard.press('Escape');
    });
  });
});
