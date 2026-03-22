/**
 * PF-681: axe-core automated accessibility audits.
 *
 * Runs automated WCAG accessibility checks against the editor on desktop.
 * Scoped to the main content area to avoid known third-party widget violations.
 *
 * Tags: @ui
 * Requires: dev server running at http://localhost:3000
 * Does NOT require WASM engine (uses loadPage() fixture).
 */

import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../fixtures/editor.fixture';

test.describe('Accessibility Audit @ui', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  // fixme: editor has known a11y violations being fixed incrementally.
  // Re-enable once EditorLayout, panels, and third-party widgets are audited.
  test.fixme('editor main area has zero critical or serious axe violations', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['color-contrast']) // dark zinc theme — tracked as PF-572
      .exclude('[data-testid="canvas-area"]') // non-DOM WebGL content
      .exclude('.dockview-theme-dark') // third-party dockview panel library
      .analyze();

    const criticalOrSerious = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    if (criticalOrSerious.length > 0) {
      const summary = criticalOrSerious.map((v) => {
        const nodeInfo = v.nodes
          .slice(0, 3)
          .map((n) => n.html)
          .join(' | ');
        return `[${v.impact}] ${v.id}: ${v.description} — ${nodeInfo}`;
      });
      // Fail with a descriptive message listing each violation
      expect.soft(criticalOrSerious, `Axe violations found:\n${summary.join('\n')}`).toHaveLength(0);
    }

    // Hard assertion — zero critical violations
    const criticalOnly = results.violations.filter((v) => v.impact === 'critical');
    expect(criticalOnly, 'Critical axe violations must be zero').toHaveLength(0);
  });

  test.fixme('editor main area has zero serious axe violations', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['color-contrast'])
      .exclude('[data-testid="canvas-area"]')
      .exclude('.dockview-theme-dark')
      .analyze();

    const seriousOnly = results.violations.filter((v) => v.impact === 'serious');
    if (seriousOnly.length > 0) {
      const summary = seriousOnly
        .map((v) => `${v.id}: ${v.description}`)
        .join('\n');
      expect(seriousOnly, `Serious axe violations:\n${summary}`).toHaveLength(0);
    }
  });

  test('settings dialog has zero critical or serious axe violations', async ({ page }) => {
    // Open the settings dialog
    const settingsBtn = page.locator('button[title="Settings"]').first();
    await expect(settingsBtn).toBeVisible({ timeout: 15_000 });
    await settingsBtn.click();

    const dialog = page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Audit only the dialog — tighter scope than full page
    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const criticalOrSerious = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    if (criticalOrSerious.length > 0) {
      const summary = criticalOrSerious
        .map((v) => `[${v.impact}] ${v.id}: ${v.description}`)
        .join('\n');
      expect(criticalOrSerious, `Settings dialog axe violations:\n${summary}`).toHaveLength(0);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 3_000 });
  });
});
