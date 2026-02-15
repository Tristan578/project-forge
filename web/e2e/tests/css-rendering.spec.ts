import { test, expect } from '../fixtures/editor.fixture';

test.describe('CSS & Visual Rendering Tests', () => {
  test('no elements with bg- class but transparent background', async ({ page, editor }) => {
    await editor.loadPage();

    // Find all elements with bg- class
    const bgElements = await page.locator('[class*="bg-"]').all();

    const transparentElements: string[] = [];

    for (const element of bgElements) {
      const isVisible = await element.isVisible();
      if (!isVisible) continue;

      const bgColor = await element.evaluate((el) => {
        return window.getComputedStyle(el).backgroundColor;
      });

      // Check for transparent or rgba(0,0,0,0)
      if (bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
        const className = await element.getAttribute('class');
        transparentElements.push(className || 'unknown');
      }
    }

    // Log any transparent elements for debugging
    if (transparentElements.length > 0) {
      console.warn('Elements with bg- class but transparent background:', transparentElements);
    }

    // This is a warning test - undefined CSS vars are a pattern we want to catch
    expect(transparentElements.length).toBeLessThan(5);
  });

  test('all visible text elements have non-zero opacity', async ({ page, editor }) => {
    await editor.loadPage();

    // Find all text-containing elements
    const textElements = await page.locator('p, span, div, h1, h2, h3, h4, h5, h6, label, button').all();

    const invisibleText: string[] = [];

    for (const element of textElements) {
      const isVisible = await element.isVisible();
      if (!isVisible) continue;

      const textContent = await element.textContent();
      if (!textContent || textContent.trim().length === 0) continue;

      const opacity = await element.evaluate((el) => {
        return window.getComputedStyle(el).opacity;
      });

      if (parseFloat(opacity) === 0) {
        invisibleText.push(textContent.substring(0, 50));
      }
    }

    expect(invisibleText).toHaveLength(0);
  });

  test('no elements clipped or hidden by overflow at default viewport', async ({ editor }) => {
    await editor.loadPage();

    // Use the fixture's assertNoInvisibleElements helper
    await editor.assertNoInvisibleElements();
  });

  test('editor layout renders with dark theme', async ({ page, editor }) => {
    await editor.loadPage();

    // Check body or main container background is dark
    const bodyBgColor = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });

    // Parse RGB values
    const match = bodyBgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    expect(match).not.toBeNull();

    const [_, r, g, b] = match!.map(Number);

    // Dark theme: RGB values should be low (< 50)
    expect(r).toBeLessThan(50);
    expect(g).toBeLessThan(50);
    expect(b).toBeLessThan(50);
  });

  test('buttons are interactive and not behind invisible overlays', async ({ page, editor }) => {
    await editor.loadPage();

    // Find all visible buttons
    const buttons = await page.locator('button:visible').all();

    expect(buttons.length).toBeGreaterThan(0);

    // Check that first few buttons are clickable (not behind overlays)
    const sampleSize = Math.min(5, buttons.length);

    for (let i = 0; i < sampleSize; i++) {
      const button = buttons[i];
      const box = await button.boundingBox();

      if (!box) continue;

      // Get element at button's center point
      const elementAtPoint = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el?.tagName;
      }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });

      // Element at point should be BUTTON or a child element (SVG, SPAN, etc.)
      // Not a completely different element
      expect(['BUTTON', 'SVG', 'SPAN', 'DIV', 'PATH']).toContain(elementAtPoint);
    }
  });

  test('panel headers are visible and styled correctly', async ({ page, editor }) => {
    await editor.loadPage();

    // Wait for dockview panels to render
    await page.waitForTimeout(500);

    // Find panel headers (dockview uses specific class names)
    const panelHeaders = await page.locator('[class*="dv-tab"]').all();

    expect(panelHeaders.length).toBeGreaterThan(0);

    for (const header of panelHeaders.slice(0, 3)) {
      // Check visibility
      await expect(header).toBeVisible();

      // Check text is readable (has contrast)
      const color = await header.evaluate((el) => {
        return window.getComputedStyle(el).color;
      });

      expect(color).not.toBe('rgba(0, 0, 0, 0)');
      expect(color).not.toBe('transparent');
    }
  });

  test('no critical layout shifts during load', async ({ page, editor }) => {
    await editor.loadPage();

    // Get initial positions of key elements
    const sidebar = page.locator('[class*="sidebar"]').first();
    const initialBox = await sidebar.boundingBox();

    // Wait for any async layout changes
    await page.waitForTimeout(1000);

    const finalBox = await sidebar.boundingBox();

    // Positions should be stable (within 5px tolerance)
    if (initialBox && finalBox) {
      expect(Math.abs(initialBox.x - finalBox.x)).toBeLessThan(5);
      expect(Math.abs(initialBox.y - finalBox.y)).toBeLessThan(5);
    }
  });
});
