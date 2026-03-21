import { test as editorTest, expect } from '../fixtures/editor.fixture';
import { test as baseTest } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Result } from 'axe-core';

/**
 * PF-681: axe-core accessibility audits — WCAG 2.1 AA compliance.
 *
 * Audits key application pages using @axe-core/playwright. Violations are
 * surfaced with element selectors and impact levels to aid debugging.
 *
 * Excluded rules / elements:
 *   - canvas elements: axe cannot introspect WebGL / WASM canvas content
 *   - color-contrast on dynamic panels that depend on Tailwind runtime colours:
 *     these are covered by manual WCAG contrast checks in the design system
 *
 * Tags used: @ui — no WASM engine required.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format axe violations into a human-readable string for assertion messages. */
function formatViolations(violations: Result[]): string {
  if (violations.length === 0) return 'no violations';
  return violations
    .map(
      (v) =>
        `[${v.impact ?? 'unknown'}] ${v.id}: ${v.nodes
          .slice(0, 2)
          .map((n) => n.html.slice(0, 80))
          .join(', ')}`
    )
    .join('\n');
}

// ---------------------------------------------------------------------------
// Editor page — /dev
// ---------------------------------------------------------------------------
editorTest.describe('Editor page axe audit @ui', () => {
  editorTest.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  editorTest('no critical or serious WCAG 2.1 AA violations', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      // canvas elements contain WASM / WebGL content — axe cannot audit them
      .exclude('canvas')
      // Exclude known dynamic Tailwind panels that render only after engine init
      .exclude('[data-testid="init-overlay"]')
      .analyze();

    // Only fail on critical or serious violations (warns on moderate/minor)
    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(
      blocking,
      `Found ${blocking.length} critical/serious WCAG 2.1 AA violations:\n${formatViolations(blocking)}`
    ).toHaveLength(0);
  });

  editorTest('no aria violations (aria-required-attr, aria-valid-attr)', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(['cat.aria'])
      .exclude('canvas')
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(
      critical,
      `Found ${critical.length} ARIA violations:\n${formatViolations(critical)}`
    ).toHaveLength(0);
  });

  editorTest('interactive elements have accessible names', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withRules(['button-name', 'link-name', 'input-button-name', 'image-alt'])
      .exclude('canvas')
      .analyze();

    expect(
      results.violations,
      `Interactive element naming violations:\n${formatViolations(results.violations)}`
    ).toHaveLength(0);
  });

  editorTest('form inputs have associated labels', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withRules(['label', 'label-content-name-mismatch'])
      .exclude('canvas')
      .analyze();

    expect(
      results.violations,
      `Form label violations:\n${formatViolations(results.violations)}`
    ).toHaveLength(0);
  });

  editorTest('no duplicate IDs that break landmark navigation', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withRules(['duplicate-id', 'duplicate-id-aria', 'duplicate-id-active'])
      .exclude('canvas')
      .analyze();

    expect(
      results.violations,
      `Duplicate ID violations:\n${formatViolations(results.violations)}`
    ).toHaveLength(0);
  });

  editorTest('document has a title', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withRules(['document-title'])
      .analyze();

    expect(
      results.violations,
      `Document title violations:\n${formatViolations(results.violations)}`
    ).toHaveLength(0);
  });

  editorTest('HTML lang attribute is set', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withRules(['html-has-lang', 'html-lang-valid', 'valid-lang'])
      .analyze();

    expect(
      results.violations,
      `HTML lang attribute violations:\n${formatViolations(results.violations)}`
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Settings dialog — /dev with dialog open
// ---------------------------------------------------------------------------
editorTest.describe('Settings dialog axe audit @ui', () => {
  editorTest('settings dialog has no critical WCAG violations', async ({ page, editor }) => {
    await editor.loadPage();

    const settingsBtn = page.locator('button[title="Settings"]').first();
    await expect(settingsBtn).toBeVisible({ timeout: 15_000 });
    await settingsBtn.click();

    await expect(
      page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]')
    ).toBeVisible({ timeout: 5_000 });

    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(
      blocking,
      `Settings dialog violations:\n${formatViolations(blocking)}`
    ).toHaveLength(0);

    await page.keyboard.press('Escape');
  });

  editorTest('dialog role and aria-labelledby are present', async ({ page, editor }) => {
    await editor.loadPage();

    const settingsBtn = page.locator('button[title="Settings"]').first();
    await expect(settingsBtn).toBeVisible({ timeout: 15_000 });
    await settingsBtn.click();

    const dialog = page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withRules(['aria-required-attr'])
      .analyze();

    expect(
      results.violations,
      `Dialog ARIA violations:\n${formatViolations(results.violations)}`
    ).toHaveLength(0);

    await page.keyboard.press('Escape');
  });
});

// ---------------------------------------------------------------------------
// Mobile viewport axe audit
// ---------------------------------------------------------------------------
editorTest.describe('Mobile viewport axe audit @ui', () => {
  editorTest('no critical violations at iPhone 14 viewport (390x844)', async ({ page, editor }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await editor.loadPage();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('canvas')
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(
      blocking,
      `iPhone 14 viewport violations:\n${formatViolations(blocking)}`
    ).toHaveLength(0);
  });

  editorTest('no critical violations at iPad viewport (768x1024)', async ({ page, editor }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await editor.loadPage();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('canvas')
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(
      blocking,
      `iPad viewport violations:\n${formatViolations(blocking)}`
    ).toHaveLength(0);
  });

  editorTest('mobile toolbar buttons have accessible names at iPhone 14 viewport', async ({ page, editor }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await editor.loadPage();

    const toolbar = page.locator('.fixed.bottom-0').first();
    await expect(toolbar).toBeVisible({ timeout: 5_000 });

    const results = await new AxeBuilder({ page })
      .include('.fixed.bottom-0')
      .withRules(['button-name'])
      .analyze();

    expect(
      results.violations,
      `Mobile toolbar button-name violations:\n${formatViolations(results.violations)}`
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Public pages — /terms, /privacy (no auth required, uses base test fixture)
// ---------------------------------------------------------------------------
baseTest.describe('Public pages axe audit @ui', () => {
  baseTest('Terms of Service page has no critical violations', async ({ page }) => {
    await page.goto('/terms');
    await page.waitForLoadState('domcontentloaded');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(
      blocking,
      `/terms critical violations:\n${formatViolations(blocking)}`
    ).toHaveLength(0);
  });

  baseTest('Privacy Policy page has no critical violations', async ({ page }) => {
    await page.goto('/privacy');
    await page.waitForLoadState('domcontentloaded');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(
      blocking,
      `/privacy critical violations:\n${formatViolations(blocking)}`
    ).toHaveLength(0);
  });

  baseTest('/terms headings are in logical order (no skipped levels)', async ({ page }) => {
    await page.goto('/terms');
    await page.waitForLoadState('domcontentloaded');

    const results = await new AxeBuilder({ page })
      .withRules(['heading-order'])
      .analyze();

    expect(
      results.violations,
      `Heading order violations on /terms:\n${formatViolations(results.violations)}`
    ).toHaveLength(0);
  });

  baseTest('/privacy headings are in logical order', async ({ page }) => {
    await page.goto('/privacy');
    await page.waitForLoadState('domcontentloaded');

    const results = await new AxeBuilder({ page })
      .withRules(['heading-order'])
      .analyze();

    expect(
      results.violations,
      `Heading order violations on /privacy:\n${formatViolations(results.violations)}`
    ).toHaveLength(0);
  });

  baseTest('/terms links have discernible text', async ({ page }) => {
    await page.goto('/terms');
    await page.waitForLoadState('domcontentloaded');

    const results = await new AxeBuilder({ page })
      .withRules(['link-name'])
      .analyze();

    expect(
      results.violations,
      `Link name violations on /terms:\n${formatViolations(results.violations)}`
    ).toHaveLength(0);
  });
});
