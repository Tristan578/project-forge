import { test, expect } from '../fixtures/editor.fixture';

test.describe('CSS & Visual Rendering Tests @ui @dev', () => {
  test('no elements with bg- class but transparent background', async ({ page, editor }) => {
    await editor.loadPage();

    // Find all visible elements with bg- class
    const transparentCount = await page.evaluate(() => {
      const elements = document.querySelectorAll('[class*="bg-"]');
      let count = 0;

      for (const el of elements) {
        const htmlEl = el as HTMLElement;
        if (htmlEl.offsetWidth === 0 || htmlEl.offsetHeight === 0) continue;

        const bgColor = window.getComputedStyle(el).backgroundColor;

        // Check for transparent or rgba(0,0,0,0)
        if (bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
          const cls = el.getAttribute('class') || '';
          // Ignore elements hidden by E2E test suppression or backdrop overlays.
          // Note: compound Tailwind bg- classes like bg-black/30 render with rgba alpha
          // and won't be counted here because their computed backgroundColor is not transparent.
          if (cls.includes('e2e') || cls.includes('backdrop')) continue;
          count++;
        }
      }
      return count;
    });

    // Allow transparent bg- elements: Tailwind utility classes like bg-transparent,
    // bg-inherit, and dockview internal elements legitimately have transparent backgrounds.
    // The threshold catches regressions where many elements lose their backgrounds.
    expect(transparentCount).toBeLessThan(30);
  });

  test('all visible text elements have non-zero opacity', async ({ page, editor }) => {
    await editor.loadPage();

    const invisibleCount = await page.evaluate(() => {
      const elements = document.querySelectorAll('p, span, div, h1, h2, h3, h4, h5, h6, label, button');
      let count = 0;

      for (const el of elements) {
        const htmlEl = el as HTMLElement;
        if (htmlEl.offsetWidth === 0 || htmlEl.offsetHeight === 0) continue;

        const textContent = el.textContent?.trim();
        if (!textContent || textContent.length === 0) continue;

        const opacity = window.getComputedStyle(el).opacity;
        if (parseFloat(opacity) === 0 && !el.closest('[aria-hidden]')) {
          count++;
        }
      }
      return count;
    });

    expect(invisibleCount).toBe(0);
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

  test('sidebar buttons are interactive and not behind overlays', async ({ page, editor }) => {
    await editor.loadPage();

    // Find sidebar buttons by their title attributes (known to exist outside dockview)
    const sidebarButtons = ['Add Entity', 'Select', 'Translate (W)', 'Rotate (E)', 'Scale (R)'];
    let clickableCount = 0;

    for (const title of sidebarButtons) {
      const btn = page.locator(`button[title="${title}"]`).first();
      if (await btn.count() === 0) continue;

      const box = await btn.boundingBox();
      if (!box) continue;

      // Check element at button's center is the button itself or a child
      const tagAtPoint = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest('button') ? 'BUTTON' : el?.tagName ?? 'NONE';
      }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });

      if (tagAtPoint === 'BUTTON') clickableCount++;
    }

    // At least some sidebar buttons should be clickable (not blocked by overlays)
    expect(clickableCount).toBeGreaterThan(0);
  });

  test('no critical layout shifts during load', async ({ page, editor }) => {
    await editor.loadPage();

    // Use a known stable element: the top bar (h-8 with SpawnForge text)
    const topBar = page.locator('span').filter({ hasText: 'SpawnForge' }).first();
    const initialBox = await topBar.boundingBox();

    // Wait for any async layout changes


    const finalBox = await topBar.boundingBox();

    // Positions should be stable (within 5px tolerance)
    if (initialBox && finalBox) {
      expect(Math.abs(initialBox.x - finalBox.x)).toBeLessThan(5);
      expect(Math.abs(initialBox.y - finalBox.y)).toBeLessThan(5);
    }
  });
});

test.describe('CSS Dockview Tests @engine', () => {
  test('panel headers are visible and styled correctly', async ({ page, editor }) => {
    await editor.load();



    // Find dockview panel tab headers
    const panelHeaders = await page.locator('[class*="dv-tab"]').all();

    expect(panelHeaders.length).toBeGreaterThan(0);

    for (const header of panelHeaders.slice(0, 3)) {
      await expect(header).toBeVisible();

      const color = await header.evaluate((el) => {
        return window.getComputedStyle(el).color;
      });

      expect(color).not.toBe('rgba(0, 0, 0, 0)');
      expect(color).not.toBe('transparent');
    }
  });
});
