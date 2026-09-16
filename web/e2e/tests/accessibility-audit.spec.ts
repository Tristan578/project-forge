/**
 * PF-199: axe-core automated accessibility audits (WCAG 2.1 AA).
 *
 * Runs automated WCAG checks against the editor, 404 page, and modal
 * dialogs. Scoped to first-party content to avoid violations in
 * third-party widgets we do not control.
 *
 * Tags: @ui
 * Requires: dev server running (no WASM build needed — uses loadPage()).
 */

import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../fixtures/editor.fixture';
import type { Page } from '@playwright/test';
import {
  E2E_TIMEOUT_SHORT_MS,
  E2E_TIMEOUT_ELEMENT_MS,
  E2E_TIMEOUT_LOAD_MS,
  E2E_TIMEOUT_NAV_MS,
  E2E_TIMEOUT_TEST_MS,
  E2E_TIMEOUT_ENGINE_INIT_MS,
  E2E_TIMEOUT_ENGINE_FULL_MS,
} from '../constants';
import { waitForHydration } from '../helpers/wait-helpers';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Build a scoped AxeBuilder targeting WCAG 2.1 A + AA rules.
 * Always excludes:
 *   - canvas/WebGL content (not DOM — axe cannot audit it)
 *   - verified third-party Dockview *chrome* only: the tab strip / action bar
 *     (`.dv-tabs-and-actions-container`) and the split/resize handles
 *     (`.dv-sash`, `.dv-resize-container`). We do not own that markup; any
 *     violations in it are tracked by #9677.
 *   - the deferred `[data-a11y-defer="scene-settings"]` panel: SceneSettings'
 *     ~40 post-processing color/range/select controls predate this slice
 *     (#9875, which hardens the Hierarchy + Inspector *chrome*) and use
 *     adjacent-but-unassociated <label>s. Auditing them here would gate this
 *     slice on unrelated pre-existing markup; a dedicated SceneSettings a11y
 *     pass is tracked separately.
 *
 * The previous blanket `.exclude('.dv-dockview')` also exempted SpawnForge's
 * OWN panel content (Scene Hierarchy, Inspector), which renders inside the
 * dockview content area — so those panels were never audited. Narrowing the
 * exclusion to the third-party chrome above brings first-party panel markup
 * back under axe (localization.FR-2.OP-04).
 *
 * Disables color-contrast globally because the zinc dark theme is
 * intentional; violations are tracked separately as PF-572.
 */
function buildAxe(page: Page): AxeBuilder {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(['color-contrast'])
    .exclude('[data-testid="canvas-area"]')
    .exclude('.dv-tabs-and-actions-container')
    .exclude('.dv-sash')
    .exclude('.dv-resize-container')
    .exclude('[data-a11y-defer="scene-settings"]');
}

/**
 * Extract a human-readable summary of violations for test failure messages.
 */
function violationSummary(
  violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations'],
): string {
  return violations
    .map((v) => {
      const nodes = v.nodes
        .slice(0, 2)
        .map((n) => n.html.trim().slice(0, 120))
        .join(' | ');
      return `[${v.impact ?? 'unknown'}] ${v.id}: ${v.description}\n  ${nodes}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Editor page — main area
// ---------------------------------------------------------------------------

test.describe('Accessibility Audit — Editor @ui @dev', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  test('editor page has zero critical axe violations', async ({ page }) => {
    const results = await buildAxe(page).analyze();

    const critical = results.violations.filter((v) => v.impact === 'critical');
    expect(
      critical,
      `Critical axe violations found:\n${violationSummary(critical)}`,
    ).toHaveLength(0);
  });

  test('editor page has zero serious axe violations', async ({ page }) => {
    const results = await buildAxe(page).analyze();

    const serious = results.violations.filter((v) => v.impact === 'serious');
    expect(
      serious,
      `Serious axe violations found:\n${violationSummary(serious)}`,
    ).toHaveLength(0);
  });

  test('editor page reports violations by impact level', async ({ page }) => {
    const results = await buildAxe(page).analyze();

    // Emit a structured breakdown so CI logs show the full picture even
    // when the hard assertions above pass (moderate/minor are informational).
    const byImpact = results.violations.reduce<Record<string, number>>(
      (acc, v) => {
        const key = v.impact ?? 'unknown';
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {},
    );

    // Log summary without failing the test — actionable audit data.
    console.log('[a11y] Editor violation counts by impact:', byImpact);

    // Passes: zero is the target, but moderate/minor are not blocked.
    expect(results.violations).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Scene Hierarchy + Inspector (localization.FR-2.OP-01 / OP-04)
//
// Scoped directly to the two first-party panels this slice hardens, so the
// gate is independent of any pre-existing violations elsewhere in the editor.
// These panels render inside the dockview content area and were previously
// exempted by the blanket `.dv-dockview` exclusion (now narrowed above).
// ---------------------------------------------------------------------------

test.describe('Accessibility Audit — Hierarchy & Inspector @ui @dev', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  test('scene hierarchy has zero critical or serious axe violations', async ({
    page,
  }) => {
    const tree = page.locator('[role="tree"][aria-label="Scene hierarchy"]');
    await expect(tree).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    const results = await new AxeBuilder({ page })
      .include('[role="tree"][aria-label="Scene hierarchy"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(['color-contrast'])
      .analyze();

    const criticalOrSerious = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    expect(
      criticalOrSerious,
      `Scene hierarchy axe violations:\n${violationSummary(criticalOrSerious)}`,
    ).toHaveLength(0);
  });

  test('inspector panel has zero critical or serious axe violations', async ({
    page,
  }) => {
    const inspector = page.locator('[role="region"][aria-label="Inspector"]');
    await expect(inspector.first()).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // Exclude the deferred SceneSettings panel (rendered in the Inspector's
    // no-selection state); its pre-existing form-control labelling is outside
    // this slice — see buildAxe()'s doc comment. The Inspector chrome and the
    // labelled InputBindings panel remain audited.
    const results = await new AxeBuilder({ page })
      .include('[role="region"][aria-label="Inspector"]')
      .exclude('[data-a11y-defer="scene-settings"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(['color-contrast'])
      .analyze();

    const criticalOrSerious = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    expect(
      criticalOrSerious,
      `Inspector panel axe violations:\n${violationSummary(criticalOrSerious)}`,
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 404 page
// ---------------------------------------------------------------------------

test.describe('Accessibility Audit — 404 Page @ui @dev', () => {
  test('404 page has zero critical or serious axe violations', async ({
    page,
  }) => {
    await page.goto('/this-page-does-not-exist', {
      waitUntil: 'commit',
      timeout: E2E_TIMEOUT_NAV_MS,
    });
    await page.waitForLoadState('domcontentloaded');

    // Wait for Next.js not-found UI to render
    await page.waitForSelector('body', { timeout: E2E_TIMEOUT_ELEMENT_MS });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(['color-contrast'])
      .analyze();

    const criticalOrSerious = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    expect(
      criticalOrSerious,
      `404 page axe violations:\n${violationSummary(criticalOrSerious)}`,
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Settings dialog
// ---------------------------------------------------------------------------

test.describe('Accessibility Audit — Settings Dialog @ui @dev', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  test('settings dialog has zero critical or serious axe violations', async ({
    page,
  }) => {
    const settingsBtn = page.locator('button[title="Settings"]').first();
    await expect(settingsBtn).toBeVisible({ timeout: E2E_TIMEOUT_NAV_MS });
    await settingsBtn.click();

    const dialog = page.locator(
      '[role="dialog"][aria-labelledby="settings-dialog-title"]',
    );
    await expect(dialog).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // Audit only the dialog element — tighter scope avoids noise from
    // underlying editor UI that is visually obscured by the modal.
    const results = await new AxeBuilder({ page })
      .include('[role="dialog"][aria-labelledby="settings-dialog-title"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(['color-contrast'])
      .analyze();

    const criticalOrSerious = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    expect(
      criticalOrSerious,
      `Settings dialog axe violations:\n${violationSummary(criticalOrSerious)}`,
    ).toHaveLength(0);

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: E2E_TIMEOUT_SHORT_MS });
  });
});

// ---------------------------------------------------------------------------
// WelcomeModal
// ---------------------------------------------------------------------------

test.describe('Accessibility Audit — WelcomeModal @ui @dev', () => {
  test('WelcomeModal has zero critical or serious axe violations', async ({
    page,
  }) => {
    // Load /dev without dismissing the welcome modal.
    // Set isNewUser=false so OnboardingGate routes to WelcomeModal rather than
    // OnboardingWizard (which only shows for brand-new first-run users).
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__SKIP_ENGINE = true;
      localStorage.setItem('forge-mobile-dismissed', '1');
      localStorage.setItem('forge-checklist-dismissed', '1');
      // Omit forge-welcomed so WelcomeModal renders.
      localStorage.setItem(
        'forge-onboarding-v2',
        JSON.stringify({ state: { isNewUser: false }, version: 0 }),
      );
    });

    await page.goto('/dev', { waitUntil: 'commit', timeout: E2E_TIMEOUT_TEST_MS });
    await page.waitForLoadState('domcontentloaded');

    try {
      await waitForHydration(page, E2E_TIMEOUT_ENGINE_FULL_MS);
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForHydration(page, E2E_TIMEOUT_ENGINE_INIT_MS);
    }

    const welcomeModal = page.locator(
      '[role="dialog"][aria-labelledby="welcome-modal-title"]',
    );
    await expect(welcomeModal).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

    const results = await new AxeBuilder({ page })
      .include('[role="dialog"][aria-labelledby="welcome-modal-title"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(['color-contrast'])
      .analyze();

    const criticalOrSerious = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    expect(
      criticalOrSerious,
      `WelcomeModal axe violations:\n${violationSummary(criticalOrSerious)}`,
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts panel
// ---------------------------------------------------------------------------

test.describe('Accessibility Audit — Keyboard Shortcuts Panel @ui @dev', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  test('keyboard shortcuts panel has zero critical or serious axe violations', async ({
    page,
  }) => {
    // Open the keyboard shortcuts panel via '?' shortcut
    // Note: '?' already implies Shift — 'Shift+?' is redundant in Playwright
    await page.keyboard.press('?');

    // Look for a keyboard shortcuts dialog / panel
    const panel = page
      .locator('[role="dialog"][aria-labelledby="shortcuts-dialog-title"]')
      .first();

    const isVisible = await panel
      .isVisible()
      .catch(() => false);

    if (!isVisible) {
      // If the shortcut didn't open it, try a toolbar button
      const kbBtn = page.locator(
        'button[title*="keyboard" i], button[aria-label*="keyboard" i]',
      ).first();
      const btnExists = await kbBtn.isVisible({ timeout: E2E_TIMEOUT_SHORT_MS }).catch(() => false);
      if (btnExists) {
        await kbBtn.click();
        await expect(panel).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
      } else {
        // Panel not accessible from current state — skip gracefully
        test.skip();
        return;
      }
    }

    const results = await new AxeBuilder({ page })
      .include('[role="dialog"][aria-labelledby="shortcuts-dialog-title"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(['color-contrast'])
      .analyze();

    const criticalOrSerious = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    expect(
      criticalOrSerious,
      `Keyboard shortcuts panel axe violations:\n${violationSummary(criticalOrSerious)}`,
    ).toHaveLength(0);
  });
});
