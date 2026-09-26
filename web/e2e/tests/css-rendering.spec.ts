import { test, expect } from '../fixtures/editor.fixture';
import { auditBackgroundColors } from '../helpers/backgroundAudit';

test.describe('CSS & Visual Rendering Tests @ui @dev', () => {
  test('active background colors are painted', async ({ page, editor }) => {
    await editor.loadPage();
    const audit = await page.evaluate(auditBackgroundColors);
    expect(audit.checked, 'the audit must examine real background-color controls').toBeGreaterThan(0);
    expect(audit.missing, 'unconditional background-color utilities must paint').toEqual([]);
  });

  test('background audit detects a lost color without counting inactive or transparent utilities', async ({ page }) => {
    await page.setContent(
      '<style>.bg-zinc-900 { background-color: rgb(24, 24, 27); } div { width: 80px; height: 40px; }</style>' +
      '<div class="bg-zinc-900">Painted</div>' +
      '<div class="hover:bg-zinc-800">Hover only</div>' +
      '<div class="bg-transparent">Transparent</div>' +
      '<div class="bg-inherit">Inherited</div>' +
      '<div class="bg-linear-to-r">Gradient</div>' +
      '<div class="bg-cover">Size only</div>' +
      '<div class="bg-black/0">Zero alpha</div>',
    );
    expect(await page.evaluate(auditBackgroundColors)).toEqual({ checked: 1, missing: [] });
    await page.locator('.bg-zinc-900').evaluate((el) => { (el as HTMLElement).style.backgroundColor = 'transparent'; });
    expect(await page.evaluate(auditBackgroundColors)).toEqual({
      checked: 1, missing: [{ tag: 'div', classes: 'bg-zinc-900' }],
    });
    await page.locator('.bg-zinc-900').evaluate((el) => {
      (el as HTMLElement).style.removeProperty('background-color');
      el.setAttribute('class', 'bg-missing-color');
    });
    expect(await page.evaluate(auditBackgroundColors)).toEqual({
      checked: 1, missing: [{ tag: 'div', classes: 'bg-missing-color' }],
    });
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
