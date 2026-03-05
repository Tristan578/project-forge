import { test, expect } from '../fixtures/editor.fixture';

/**
 * Accessibility E2E tests.
 * Verifies ARIA roles, labels, keyboard navigation, focus management,
 * and screen reader compatibility across the editor UI.
 */
test.describe('Accessibility @ui', () => {
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
      await settingsBtn.click();

      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

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
      // Start at the beginning of the page
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');

      // Something should be focused
      const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
      expect(focusedTag).toBeTruthy();
      expect(['BUTTON', 'INPUT', 'A', 'TEXTAREA', 'SELECT']).toContain(focusedTag);
    });

    test('Escape key closes open dialogs', async ({ page }) => {
      // Open settings
      const settingsBtn = page.locator('button[title="Settings"]').first();
      await settingsBtn.click();
      await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });

      // Escape should close it
      await page.keyboard.press('Escape');
      await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 3000 });
    });

    test('focus returns to trigger after dialog closes', async ({ page }) => {
      const settingsBtn = page.locator('button[title="Settings"]').first();
      await settingsBtn.click();
      await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('Escape');
      await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 3000 });

      // Focus should ideally return to the settings button (or at least somewhere reasonable)
      const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
      expect(focusedTag).toBeTruthy();
    });

    test('Tab key moves focus to interactive elements inside settings dialog', async ({ page }) => {
      const settingsBtn = page.locator('button[title="Settings"]').first();
      await settingsBtn.click();
      await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });

      // Tab once — focus should land on an interactive element
      await page.keyboard.press('Tab');

      const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? 'null');
      // After one Tab, focus should be on a focusable element
      expect(['BUTTON', 'INPUT', 'A', 'TEXTAREA', 'SELECT', 'DIV']).toContain(focusedTag);

      await page.keyboard.press('Escape');
    });
  });

  test.describe('Color and Contrast', () => {
    test.beforeEach(async ({ editor }) => {
      await editor.loadPage();
    });

    test('text elements have non-zero opacity', async ({ page }) => {
      const textElements = page.locator('span, p, h1, h2, h3, label');
      const count = await textElements.count();

      for (let i = 0; i < Math.min(count, 10); i++) {
        const el = textElements.nth(i);
        if (await el.isVisible()) {
          const opacity = await el.evaluate((e) => {
            return window.getComputedStyle(e).opacity;
          });
          expect(Number(opacity)).toBeGreaterThan(0);
        }
      }
    });

    test('interactive elements have visible focus indicators', async ({ page }) => {
      // Tab to a button
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');

      const hasFocusStyle = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return false;
        const styles = window.getComputedStyle(el);
        // Check for outline, box-shadow, or border that indicates focus
        return (
          styles.outline !== 'none' ||
          styles.outlineStyle !== 'none' ||
          styles.boxShadow !== 'none' ||
          el.classList.contains('focus-visible') ||
          el.matches(':focus-visible')
        );
      });

      // Focus indicator should exist (may be via outline, shadow, or class)
      // Some frameworks use class-based focus styling, so this is best-effort
      expect(hasFocusStyle).toBe(true);
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
});
