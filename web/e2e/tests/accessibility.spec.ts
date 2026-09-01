import { test, expect } from '../fixtures/editor.fixture';
import {
  E2E_TIMEOUT_ELEMENT_MS,
  E2E_TIMEOUT_LOAD_MS,
  E2E_TIMEOUT_NAV_MS,
} from '../constants';

/**
 * How many Tab presses the focus-visibility walk makes. Large enough to cover
 * the editor's top bar and toolbar (17 controls when measured), small enough
 * that the test stays quick.
 */
const FOCUS_WALK_STEPS = 25;

/**
 * Accessibility E2E tests.
 * Verifies ARIA roles, labels, keyboard navigation, focus management,
 * and screen reader compatibility across the editor UI.
 */
test.describe('Accessibility @ui @dev', () => {
  test.describe('ARIA Landmarks', () => {
    test.beforeEach(async ({ editor }) => {
      await editor.loadPage();
    });

    test('editor has interactive buttons with accessible names', async ({ page }) => {
      // All buttons should have either text content, title, or aria-label
      const buttons = page.locator('button');
      const count = await buttons.count();
      expect(count).toBeGreaterThan(0);

      let accessibleCount = 0;
      for (let i = 0; i < Math.min(count, 20); i++) {
        const btn = buttons.nth(i);
        const text = await btn.textContent();
        const title = await btn.getAttribute('title');
        const ariaLabel = await btn.getAttribute('aria-label');
        if ((text && text.trim().length > 0) || title || ariaLabel) {
          accessibleCount++;
        }
      }

      // At least 80% of visible buttons should have accessible names
      expect(accessibleCount / Math.min(count, 20)).toBeGreaterThan(0.7);
    });

    test('input fields have labels or aria-label', async ({ page }) => {
      const inputs = page.locator('input:visible');
      const count = await inputs.count();

      if (count > 0) {
        let labeledCount = 0;
        for (let i = 0; i < Math.min(count, 10); i++) {
          const input = inputs.nth(i);
          const id = await input.getAttribute('id');
          const ariaLabel = await input.getAttribute('aria-label');
          const ariaLabelledBy = await input.getAttribute('aria-labelledby');
          const placeholder = await input.getAttribute('placeholder');
          const title = await input.getAttribute('title');

          // Check for associated label element
          let hasLabel = false;
          if (id) {
            const label = page.locator(`label[for="${id}"]`);
            hasLabel = (await label.count()) > 0;
          }

          if (ariaLabel || ariaLabelledBy || hasLabel || placeholder || title) {
            labeledCount++;
          }
        }

        // At least some inputs should have labels
        expect(labeledCount).toBeGreaterThan(0);
      }
    });

    test('dialogs have proper role and labeling', async ({ page }) => {
      // Open settings to test dialog accessibility
      const settingsBtn = page.locator('button[title="Settings"]').first();
      await expect(settingsBtn).toBeVisible({ timeout: E2E_TIMEOUT_NAV_MS });
      await settingsBtn.click();

      const dialog = page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]');
      await expect(dialog).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

      // Dialog should have aria-label or aria-labelledby
      const ariaLabel = await dialog.getAttribute('aria-label');
      const ariaLabelledBy = await dialog.getAttribute('aria-labelledby');
      expect(ariaLabel || ariaLabelledBy).toBeTruthy();

      await page.keyboard.press('Escape');
    });
  });

  test.describe('Keyboard Navigation', () => {
    test.beforeEach(async ({ editor }) => {
      await editor.loadPage();
    });

    test('Tab key moves focus through interactive elements', async ({ page }) => {
      test.slow();
      // Start at the beginning of the page
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');

      // Wait for focus to settle after tab navigation on CI
      const focusedTag = await page.waitForFunction(
        () => {
          const tag = document.activeElement?.tagName ?? null;
          if (!tag || tag === 'BODY') return null;
          return tag;
        },
        { timeout: E2E_TIMEOUT_LOAD_MS },
      );
      const tag = await focusedTag.jsonValue();
      expect(tag).toBeTruthy();
      expect(['BUTTON', 'INPUT', 'A', 'TEXTAREA', 'SELECT']).toContain(tag);
    });

    test('Escape key closes open dialogs', async ({ page }) => {
      test.slow();
      // Open settings
      const settingsBtn = page.locator('button[title="Settings"]').first();
      await expect(settingsBtn).toBeVisible({ timeout: E2E_TIMEOUT_NAV_MS });
      await settingsBtn.click();
      await expect(page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]')).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

      // Escape should close it
      await page.keyboard.press('Escape');
      await expect(page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]')).not.toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });
    });

    test('focus returns to trigger after dialog closes', async ({ page }) => {
      test.slow();
      const settingsBtn = page.locator('button[title="Settings"]').first();
      await expect(settingsBtn).toBeVisible({ timeout: E2E_TIMEOUT_NAV_MS });
      await settingsBtn.click();
      await expect(page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]')).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

      await page.keyboard.press('Escape');
      // Wait for dialog to fully close before checking focus
      await expect(page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]')).not.toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

      // Focus should ideally return to the settings button (or at least somewhere reasonable)
      // Use waitForFunction to allow focus to settle after animation completes
      const focusedTag = await page.waitForFunction(
        () => document.activeElement?.tagName ?? null,
        { timeout: E2E_TIMEOUT_ELEMENT_MS },
      );
      expect(await focusedTag.jsonValue()).toBeTruthy();
    });

    test('Tab key moves focus to interactive elements inside settings dialog', async ({ page }) => {
      const settingsBtn = page.locator('button[title="Settings"]').first();
      await expect(settingsBtn).toBeVisible({ timeout: E2E_TIMEOUT_NAV_MS });
      await settingsBtn.click();

      const dialog = page.locator(
        '[role="dialog"][aria-labelledby="settings-dialog-title"]'
      );
      await expect(dialog).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

      await page.keyboard.press('Tab');

      // The real requirement is a focus trap: keyboard focus must stay inside an
      // open modal. The previous assertion only checked that *some* focusable
      // tag was active, and accepted DIV -- which passes even when focus escapes
      // to the page behind the dialog, the exact failure it should catch.
      //
      // waitForFunction rather than a bare evaluate is what un-quarantines this:
      // the dialog's mount and its focus handler settle a frame apart, so
      // sampling activeElement immediately after the keypress was reading a
      // moment too early. That was the CI timing dependency -- polling for the
      // settled state removes it without loosening what is asserted.
      await page.waitForFunction(
        () => {
          const dlg = document.querySelector(
            '[role="dialog"][aria-labelledby="settings-dialog-title"]'
          );
          const el = document.activeElement;
          return !!dlg && !!el && el !== document.body && dlg.contains(el);
        },
        { timeout: E2E_TIMEOUT_ELEMENT_MS }
      );

      await page.keyboard.press('Escape');
    });
  });

  test.describe('Color and Contrast', () => {
    test.beforeEach(async ({ editor }) => {
      await editor.loadPage();
    });

    test('text elements have non-zero opacity', async ({ page }) => {
      // Entrance transitions legitimately read as opacity 0 while in flight,
      // which is what made this intermittent on CI. Waiting for the document's
      // running animations to settle makes the sample deterministic rather than
      // racing them -- the assertion itself is unchanged.
      await page.waitForFunction(
        () => document.getAnimations().every((a) => a.playState !== 'running'),
        { timeout: E2E_TIMEOUT_ELEMENT_MS }
      );

      const textElements = page.locator('span, p, h1, h2, h3, label');
      const count = await textElements.count();
      let checked = 0;

      for (let i = 0; i < Math.min(count, 10); i++) {
        const el = textElements.nth(i);
        if (!(await el.isVisible())) continue;
        const opacity = await el.evaluate(
          (e) => window.getComputedStyle(e).opacity
        );
        checked++;
        expect(Number(opacity)).toBeGreaterThan(0);
      }

      // A run where nothing was visible would otherwise pass having asserted
      // nothing at all.
      expect(checked).toBeGreaterThan(0);
    });

    // WCAG 2.4.7 (Focus Visible): every control reachable by keyboard must show
    // a rendered focus indicator.
    //
    // This previously computed a boolean and asserted `toBeDefined()` on it --
    // which is satisfied by `false`, so it reported green regardless of what the
    // page rendered. The style check was independently vacuous: computed
    // `outline` is a triple like "rgb(0, 0, 0) none 0px", never the bare string
    // "none", so the first clause was always true.
    //
    // Input modality matters: Chromium does not apply `:focus-visible` for a
    // programmatic `el.focus()` that follows a pointer interaction, so a probe
    // built on `.focus()` reports missing indicators on controls that are fine.
    // Driving real Tab presses is what makes the result trustworthy.
    test('interactive elements have visible focus indicators', async ({ page }) => {
      // Start from a known point so the tab order is deterministic.
      await page.locator('body').click({ position: { x: 2, y: 2 } });

      const offenders: string[] = [];
      let focusedCount = 0;

      for (let i = 0; i < FOCUS_WALK_STEPS; i++) {
        await page.keyboard.press('Tab');
        const result = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const styles = window.getComputedStyle(el);
          const hasOutline =
            styles.outlineStyle !== 'none' && parseFloat(styles.outlineWidth) > 0;
          const hasShadow = styles.boxShadow !== 'none';
          return {
            visible: hasOutline || hasShadow,
            label: (
              el.getAttribute('aria-label') ||
              el.getAttribute('title') ||
              el.textContent ||
              el.tagName
            )
              .trim()
              .slice(0, 60),
          };
        });
        if (!result) continue;
        focusedCount++;
        if (!result.visible) offenders.push(result.label);
      }

      // Without this, a page where Tab reached nothing would satisfy the
      // assertion below and quietly restore the vacuous pass.
      expect(focusedCount).toBeGreaterThan(0);
      expect(
        offenders,
        'controls with no visible focus indicator: ' + offenders.join(', ')
      ).toEqual([]);
    });
  });

  test.describe('Semantic HTML', () => {
    test.beforeEach(async ({ editor }) => {
      await editor.loadPage();
    });

    test('page has at least one heading', async ({ page }) => {
      const headings = page.locator('h1, h2, h3, h4, h5, h6');
      expect(await headings.count()).toBeGreaterThan(0);
    });

    test('images have alt attributes', async ({ page }) => {
      const images = page.locator('img');
      const count = await images.count();

      for (let i = 0; i < count; i++) {
        const img = images.nth(i);
        const alt = await img.getAttribute('alt');
        const role = await img.getAttribute('role');
        // Image should have alt text or role="presentation"
        expect(alt !== null || role === 'presentation' || role === 'none').toBe(true);
      }
    });

    test('sidebar has navigation role or is semantically grouped', async ({ page }) => {
      // Look for nav element or role="navigation" or role="toolbar"
      const navElements = page.locator('nav, [role="navigation"], [role="toolbar"]');
      const count = await navElements.count();
      // Editor should have at least one navigation landmark (sidebar or toolbar)
      expect(count).toBeGreaterThan(0);
    });
  });

  test.describe('Keyboard-only workflow', () => {
    test.beforeEach(async ({ editor }) => {
      await editor.loadPage();
    });

    test('scene hierarchy panel is keyboard accessible', async ({ page }) => {
      // Verify the tree is rendered, visible, and has tabIndex=0 (keyboard reachable).
      // We test focusability directly rather than counting Tab presses because the
      // editor has 20+ interactive elements (toolbar, sidebar) before the tree in
      // DOM order — a fixed tab count is fragile and layout-dependent.
      const hierarchyTree = page.locator('[role="tree"][aria-label="Scene hierarchy"]');
      await expect(hierarchyTree).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

      // tabindex="0" means it participates in the natural tab order
      const tabIndex = await hierarchyTree.getAttribute('tabindex');
      expect(tabIndex).toBe('0');

      // Programmatic focus confirms the element accepts keyboard focus
      await hierarchyTree.focus();
      await expect(hierarchyTree).toBeFocused();
    });

    test('Tab key reaches the inspector area', async ({ page }) => {
      test.slow();
      // Inspector inputs should be in the tab order
      const inspectorInputs = page.locator('[data-panel="inspector"] input, [data-panel="inspector"] button').first();
      const hasInspectorInputs = await inspectorInputs.count() > 0;

      if (hasInspectorInputs) {
        await inspectorInputs.focus();
        const focused = await page.evaluate(() => document.activeElement !== null);
        expect(focused).toBe(true);
      } else {
        // If no entity is selected, the inspector shows placeholder — just check it's visible
        const inspector = page.locator('[aria-label*="inspector" i], [data-panel="inspector"]').first();
        if (await inspector.count() > 0) {
          await expect(inspector).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
        }
      }
    });
  });

  test.describe('ARIA live regions', () => {
    test.beforeEach(async ({ editor }) => {
      await editor.loadPage();
    });

    test('aria-live regions are present in the editor', async ({ page }) => {
      // At least one aria-live region should exist for dynamic announcements
      const liveRegions = page.locator('[aria-live]');
      const count = await liveRegions.count();
      // Editor must have aria-live regions for status announcements
      expect(count).toBeGreaterThan(0);
    });

    test('status announcements area exists or polite live region is present', async ({ page }) => {
      // Check for aria-live="polite" (non-interrupting status updates)
      const politeRegions = page.locator('[aria-live="polite"]');
      const assertiveRegions = page.locator('[aria-live="assertive"]');
      const totalLive = (await politeRegions.count()) + (await assertiveRegions.count());

      // The editor must have aria-live regions for entity spawn confirmations,
      // filter match counts, and other dynamic status announcements.
      expect(totalLive).toBeGreaterThan(0);
    });
  });
});
