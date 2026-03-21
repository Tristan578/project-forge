import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/editor.fixture';
import { test as baseTest } from '@playwright/test';

/**
 * PF-681: axe-core WCAG 2.1 AA accessibility audits.
 *
 * Uses @axe-core/playwright to scan for critical and serious violations across:
 * - Editor page (canvas excluded — WebGL canvas is opaque to axe)
 * - Public pages (/terms, /privacy)
 * - Mobile viewports (iPhone 14, iPad)
 *
 * No rules are disabled, no violations are suppressed. If a test fails it means
 * a real accessibility violation exists and MUST be fixed in the source code.
 *
 * The editor UI was hardened for a11y (color-contrast, ARIA labels) before
 * these tests were written (PR #7189). These tests lock in that state.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an AxeBuilder configured for WCAG 2.1 AA on critical+serious impact.
 * The canvas element is always excluded — axe cannot audit WebGL/WebGPU canvas
 * content and emitting false positives for it would mask real violations.
 */
function editorAxe(page: Page): AxeBuilder {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('canvas');
}

/** Run axe and assert zero critical or serious violations. */
async function assertNoViolations(axeBuilder: AxeBuilder): Promise<void> {
  const results = await axeBuilder.analyze();
  const blockers = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );

  if (blockers.length > 0) {
    // Emit a readable summary so CI output identifies exactly what to fix
    const summary = blockers
      .map(
        (v) =>
          `[${v.impact?.toUpperCase()}] ${v.id}: ${v.description}\n` +
          v.nodes
            .slice(0, 3)
            .map((n) => `  - ${n.html.slice(0, 120)}`)
            .join('\n'),
      )
      .join('\n\n');

    expect(blockers, `axe found ${blockers.length} critical/serious violation(s):\n\n${summary}`).toHaveLength(0);
  }
}

// ---------------------------------------------------------------------------
// Editor page — desktop viewport
// ---------------------------------------------------------------------------
test.describe('Editor Page WCAG 2.1 AA Audit @ui', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  test('no critical or serious violations on initial load', async ({ page }) => {
    await assertNoViolations(editorAxe(page));
  });

  test('no critical or serious violations with settings dialog open', async ({ page }) => {
    const settingsBtn = page.locator('button[title="Settings"]').first();
    await expect(settingsBtn).toBeVisible({ timeout: 15_000 });
    await settingsBtn.click();

    await expect(
      page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]'),
    ).toBeVisible({ timeout: 5_000 });

    await assertNoViolations(editorAxe(page));

    await page.keyboard.press('Escape');
  });

  test('no critical or serious violations with scene hierarchy visible', async ({ page }) => {
    // Hierarchy panel is always visible on desktop — audit the full layout
    const navOrHierarchy = page.locator('nav, [role="navigation"], [aria-label="Scene Hierarchy"]').first();
    await expect(navOrHierarchy).toBeAttached({ timeout: 5_000 });

    await assertNoViolations(editorAxe(page));
  });
});

// ---------------------------------------------------------------------------
// Public pages — /terms and /privacy
// ---------------------------------------------------------------------------
baseTest.describe('Public Pages WCAG 2.1 AA Audit @ui', () => {
  baseTest('terms of service has no critical violations', async ({ page }) => {
    await page.goto('/terms');
    await page.waitForLoadState('domcontentloaded');

    const axe = new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
    await assertNoViolations(axe);
  });

  baseTest('privacy policy has no critical violations', async ({ page }) => {
    await page.goto('/privacy');
    await page.waitForLoadState('domcontentloaded');

    const axe = new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
    await assertNoViolations(axe);
  });
});

// ---------------------------------------------------------------------------
// Mobile viewports — editor page
// ---------------------------------------------------------------------------
test.describe('Mobile Viewport WCAG 2.1 AA Audit @ui', () => {
  test('iPhone 14 (390x844) editor has no critical violations', async ({ page, editor }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await editor.loadPage();

    await assertNoViolations(editorAxe(page));
  });

  test('iPad (768x1024) editor has no critical violations', async ({ page, editor }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await editor.loadPage();

    await assertNoViolations(editorAxe(page));
  });

  test('iPhone 14 mobile toolbar buttons all have accessible names', async ({ page, editor }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await editor.loadPage();

    const toolbar = page.locator('.fixed.bottom-0').first();
    await expect(toolbar).toBeVisible({ timeout: 5_000 });

    // Audit only the mobile toolbar — focused scan to catch icon-only buttons
    const toolbarAxe = new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .include('.fixed.bottom-0');

    await assertNoViolations(toolbarAxe);
  });

  test('iPad mobile toolbar buttons all have accessible names', async ({ page, editor }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await editor.loadPage();

    const toolbar = page.locator('.fixed.bottom-0').first();
    await expect(toolbar).toBeVisible({ timeout: 5_000 });

    const toolbarAxe = new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .include('.fixed.bottom-0');

    await assertNoViolations(toolbarAxe);
  });
});
